// @graph-layer: private
// @rationale: private (per-IP throttle on public surfaces)
//
// src/lib/services/marketing/rateLimit.ts
//
// Tiny in-memory sliding-window rate limiter. One bucket per (key, kind).
// Used by the marketing-public API surfaces (email-gate, promo validate,
// referral track) to bound flood-send and code-enumeration attacks.
//
// In production this should be backed by a durable store (Redis / Upstash);
// for the v1 single-instance deploy the in-memory map is acceptable. The
// failure mode is "rate-limit resets on restart" which is less bad than
// "rate-limit silently broken".
//
// Memory bounds (added 2026-06-04 per adversarial review):
//   - Empty buckets are deleted on the same `allow()` call that drains them
//     (the common case after a window elapses with no new traffic).
//   - The Map is hard-capped at `maxKeys` entries (default 100_000). When
//     insertion would exceed the cap, the LEAST-RECENTLY-USED key is evicted
//     first. Tracked implicitly via Map iteration order (insertion order);
//     `allow()` re-inserts the touched key to move it to the back.
//   - A periodic sweep (every `sweepEveryN` allow() calls, default 1000)
//     also drops buckets whose newest event is older than the window —
//     defense in depth against keys that hit once and never return.

export interface RateLimitOpts {
	/** Window in ms. */
	windowMs: number;
	/** Max events per window. */
	max: number;
	/**
	 * Hard cap on tracked keys. Default 100_000. When insertion would
	 * exceed the cap, the LRU key is evicted. Set to 0 to disable the cap
	 * (NOT recommended outside tests).
	 */
	maxKeys?: number;
	/**
	 * Run a periodic sweep every N `allow()` calls dropping any bucket
	 * whose newest event is older than the window. Default 1000. Set to 0
	 * to disable.
	 */
	sweepEveryN?: number;
}

export interface RateLimitResult {
	ok: boolean;
	/** When ok=false: ms until earliest slot frees. */
	retryAfterMs?: number;
	/** Remaining requests in this window. */
	remaining: number;
}

interface Bucket {
	events: number[]; // ms timestamps
}

const DEFAULT_MAX_KEYS = 100_000;
const DEFAULT_SWEEP_EVERY_N = 1000;

export class RateLimiter {
	private _buckets = new Map<string, Bucket>();
	private _maxKeys: number;
	private _sweepEveryN: number;
	private _callsSinceSweep = 0;

	constructor(private opts: RateLimitOpts, private nowSource: () => number = () => Date.now()) {
		this._maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
		this._sweepEveryN = opts.sweepEveryN ?? DEFAULT_SWEEP_EVERY_N;
	}

	allow(key: string): RateLimitResult {
		const now = this.nowSource();
		const windowStart = now - this.opts.windowMs;

		// Periodic sweep — drops buckets whose newest event is outside the window.
		// Covers the "hit once and never return" pattern that the per-call
		// empty-bucket eviction can't catch on its own.
		if (this._sweepEveryN > 0) {
			this._callsSinceSweep++;
			if (this._callsSinceSweep >= this._sweepEveryN) {
				this._callsSinceSweep = 0;
				this._sweepExpired(windowStart);
			}
		}

		let bucket = this._buckets.get(key);
		if (!bucket) {
			bucket = { events: [] };
			// LRU: enforce cap BEFORE insert so peak Map size stays at maxKeys.
			if (this._maxKeys > 0 && this._buckets.size >= this._maxKeys) {
				// Map iteration is insertion order; the first key is the LRU one.
				const lruKey = this._buckets.keys().next().value;
				if (lruKey !== undefined) this._buckets.delete(lruKey);
			}
			this._buckets.set(key, bucket);
		} else {
			// LRU touch: move the key to the back by delete + re-insert.
			// This keeps Map iteration order aligned with recency.
			this._buckets.delete(key);
			this._buckets.set(key, bucket);
		}
		// Drop expired events.
		bucket.events = bucket.events.filter((t) => t >= windowStart);
		if (bucket.events.length >= this.opts.max) {
			const earliest = bucket.events[0];
			return {
				ok: false,
				retryAfterMs: Math.max(0, earliest + this.opts.windowMs - now),
				remaining: 0,
			};
		}
		bucket.events.push(now);
		return { ok: true, remaining: this.opts.max - bucket.events.length };
	}

	reset(key?: string): void {
		if (key === undefined) {
			this._buckets.clear();
			this._callsSinceSweep = 0;
		} else {
			this._buckets.delete(key);
		}
	}

	/** Snapshot - debug / tests. */
	size(): number {
		return this._buckets.size;
	}

	/**
	 * Drop any bucket whose newest event is older than the window start.
	 * Also drops buckets that are empty (events.length === 0). Pure bookkeeping.
	 */
	private _sweepExpired(windowStart: number): void {
		for (const [key, bucket] of this._buckets) {
			if (bucket.events.length === 0) {
				this._buckets.delete(key);
				continue;
			}
			const newest = bucket.events[bucket.events.length - 1];
			if (newest < windowStart) this._buckets.delete(key);
		}
	}

	/** Test helper: force the periodic sweep right now. */
	__sweepForTests(): void {
		this._sweepExpired(this.nowSource() - this.opts.windowMs);
	}
}

// ---------------------------------------------------------------------------
// Shared singletons used by the API endpoints
// ---------------------------------------------------------------------------

/** Email-gate per-IP limiter: 10 submissions per hour. */
export const gateRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
/** Promo-code per-IP limiter (cookie-present): 30 validation attempts per hour. */
export const promoRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });
/**
 * Anonymous-promo limiter (no gate cookie): 10/IP/hour. Tighter because the
 * caller has never proven knowledge of a parent email, so each anonymous
 * request is a pure code-enumeration probe.
 */
export const anonymousPromoRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
/** Referral track per-IP limiter: 60 events per hour. */
export const referralRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 60 });

/** Test helper - drains all in-memory buckets. */
export function __resetRateLimitersForTests(): void {
	gateRateLimit.reset();
	promoRateLimit.reset();
	anonymousPromoRateLimit.reset();
	referralRateLimit.reset();
}
