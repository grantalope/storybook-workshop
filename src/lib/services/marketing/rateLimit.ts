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

export interface RateLimitOpts {
	/** Window in ms. */
	windowMs: number;
	/** Max events per window. */
	max: number;
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

export class RateLimiter {
	private _buckets = new Map<string, Bucket>();

	constructor(private opts: RateLimitOpts, private nowSource: () => number = () => Date.now()) {}

	allow(key: string): RateLimitResult {
		const now = this.nowSource();
		const windowStart = now - this.opts.windowMs;
		let bucket = this._buckets.get(key);
		if (!bucket) {
			bucket = { events: [] };
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
		if (key === undefined) this._buckets.clear();
		else this._buckets.delete(key);
	}

	/** Snapshot — debug / tests. */
	size(): number {
		return this._buckets.size;
	}
}

// ---------------------------------------------------------------------------
// Shared singletons used by the API endpoints
// ---------------------------------------------------------------------------

/** Email-gate per-IP limiter: 10 submissions per hour. */
export const gateRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
/** Promo-code per-IP limiter: 30 validation attempts per hour. */
export const promoRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });
/** Referral track per-IP limiter: 60 events per hour. */
export const referralRateLimit = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 60 });

/** Test helper — drains all in-memory buckets. */
export function __resetRateLimitersForTests(): void {
	gateRateLimit.reset();
	promoRateLimit.reset();
	referralRateLimit.reset();
}
