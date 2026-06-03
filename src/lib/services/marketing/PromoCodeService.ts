// @graph-layer: private
// @rationale: private (promo codes affect billing; CSPRNG required)
//
// src/lib/services/marketing/PromoCodeService.ts
//
// Promo code minting, validation, redemption.
//
// Per spec §8.2 + §8.5 the marketing funnel mints three promo categories:
//   - first_time:    BEDTIME10, 10% off (capped $5), single-use per parent
//   - abandoned_cart: per-cart code, 5/10/15% off (1-time per parent per cart)
//   - birthday:      per-kid code, 15% off, fires 6w before kid's birthday
//   - series_discount: a generic shape — uses by SubscriptionEngine
//
// Single-promo-per-order is enforced via `redeem(orderId, code)`: re-applying
// or applying a second code to the same `orderId` is rejected with
// `already_used_in_order`.
//
// CSPRNG-derived random codes via $lib/services/subscription/secureRandom
// (per CLAUDE.md CSPRNG policy + cross-deps note).
//
// Spec: docs/specs/2026-05-24-design.md §8

import { secureRandomString } from '$lib/services/subscription/secureRandom';
import type {
	PromoCode,
	PromoApplyResult,
	PromoType,
	PromoValidationResult,
} from './types';

/** Fixed first-time code shape — spec literal. */
export const FIRST_TIME_CODE = 'BEDTIME10';
const FIRST_TIME_PCT = 10;
/** Cap first-time discount at $5. */
const FIRST_TIME_MAX_CENTS = 500;
const BIRTHDAY_PCT = 15;
/** Code alphabet — no ambiguous chars (0/O/1/l/I omitted). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export interface PromoCodeServiceOpts {
	nowSource?: () => number;
	/** Override for tests — deterministic code generation. */
	codeGen?: () => string;
}

export class PromoCodeService {
	private _codes = new Map<string, PromoCode>();
	/** Per-parent set of first-time codes redeemed (drives single-use). */
	private _firstTimeRedeemed = new Set<string>();
	/** orderId → code map (single-promo-per-order). */
	private _orderRedemptions = new Map<string, string>();

	constructor(private opts: PromoCodeServiceOpts = {}) {
		// Seed the fixed first-time code.
		this._codes.set(FIRST_TIME_CODE, {
			code: FIRST_TIME_CODE,
			type: 'first_time',
			pctOff: FIRST_TIME_PCT,
			maxDiscountCents: FIRST_TIME_MAX_CENTS,
			createdAt: this._now(),
			usageCount: 0,
			// no expiry; capped by single-use-per-parent
		});
	}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	private _genCode(): string {
		if (this.opts.codeGen) return this.opts.codeGen();
		for (let i = 0; i < 100; i++) {
			const code = secureRandomString(CODE_LENGTH, CODE_ALPHABET);
			if (!this._codes.has(code)) return code;
		}
		throw new Error('PromoCodeService: failed to mint unique code after 100 tries');
	}

	/** Mint a per-cart abandoned-cart promo. */
	mintAbandonedCartPromo(opts: {
		parentEmail: string;
		cartId: string;
		pctOff: number;
	}): PromoCode {
		const code = this._genCode();
		const promo: PromoCode = {
			code,
			type: 'abandoned_cart',
			pctOff: opts.pctOff,
			createdAt: this._now(),
			usageCount: 0,
			maxUsage: 1,
			scopedToParentEmail: opts.parentEmail,
		};
		this._codes.set(code, promo);
		return promo;
	}

	/** Mint a 15% birthday promo for a specific parent. */
	mintBirthdayPromo(parentEmail: string, expiresInMs = 14 * 24 * 60 * 60 * 1000): PromoCode {
		const code = this._genCode();
		const promo: PromoCode = {
			code,
			type: 'birthday',
			pctOff: BIRTHDAY_PCT,
			createdAt: this._now(),
			expiresAt: this._now() + expiresInMs,
			usageCount: 0,
			maxUsage: 1,
			scopedToParentEmail: parentEmail,
		};
		this._codes.set(code, promo);
		return promo;
	}

	/** Mint a generic series-discount promo (e.g. driven by SubscriptionEngine). */
	mintSeriesDiscount(opts: {
		pctOff: number;
		scopedToParentEmail?: string;
		maxUsage?: number;
		expiresInMs?: number;
	}): PromoCode {
		const code = this._genCode();
		const promo: PromoCode = {
			code,
			type: 'series_discount',
			pctOff: opts.pctOff,
			createdAt: this._now(),
			expiresAt: opts.expiresInMs ? this._now() + opts.expiresInMs : undefined,
			usageCount: 0,
			maxUsage: opts.maxUsage,
			scopedToParentEmail: opts.scopedToParentEmail,
		};
		this._codes.set(code, promo);
		return promo;
	}

	/** Look up a code (test/admin helper). */
	getCode(code: string): PromoCode | undefined {
		return this._codes.get(code);
	}

	/**
	 * Validate a code without redeeming it. Used at checkout to display
	 * the discount preview.
	 */
	validate(opts: {
		code: string;
		parentEmail: string;
		orderId?: string;
	}): PromoValidationResult {
		const code = this._codes.get(opts.code.toUpperCase());
		if (!code) return { ok: false, error: 'unknown' };
		const now = this._now();
		if (code.expiresAt && now > code.expiresAt) {
			return { ok: false, error: 'expired' };
		}
		if (
			code.type === 'first_time' &&
			this._firstTimeRedeemed.has(opts.parentEmail.toLowerCase())
		) {
			return { ok: false, error: 'exhausted' };
		}
		if (code.maxUsage !== undefined && code.usageCount >= code.maxUsage) {
			return { ok: false, error: 'exhausted' };
		}
		if (
			code.scopedToParentEmail &&
			code.scopedToParentEmail.toLowerCase() !== opts.parentEmail.toLowerCase()
		) {
			return { ok: false, error: 'wrong_parent' };
		}
		if (opts.orderId) {
			const existing = this._orderRedemptions.get(opts.orderId);
			if (existing && existing !== code.code) {
				return { ok: false, error: 'already_used_in_order' };
			}
		}
		return { ok: true, code };
	}

	/**
	 * Apply a code to a subtotal — returns discount + final amounts. Caller
	 * decides whether to actually `redeem` (which marks usage). Validates first.
	 */
	apply(opts: {
		code: string;
		parentEmail: string;
		subtotalCents: number;
		orderId?: string;
	}): PromoApplyResult {
		const v = this.validate({
			code: opts.code,
			parentEmail: opts.parentEmail,
			orderId: opts.orderId,
		});
		if (!v.ok || !v.code) {
			return { ok: false, discountCents: 0, finalCents: opts.subtotalCents, error: v.error };
		}
		const raw = Math.floor((opts.subtotalCents * v.code.pctOff) / 100);
		const cap = v.code.maxDiscountCents ?? Number.POSITIVE_INFINITY;
		const discountCents = Math.min(raw, cap);
		return {
			ok: true,
			discountCents,
			finalCents: opts.subtotalCents - discountCents,
		};
	}

	/** Commit a redemption — invoked from the order POST endpoint after Stripe success. */
	redeem(opts: {
		code: string;
		parentEmail: string;
		orderId: string;
	}): PromoValidationResult {
		const v = this.validate({
			code: opts.code,
			parentEmail: opts.parentEmail,
			orderId: opts.orderId,
		});
		if (!v.ok || !v.code) return v;
		const existing = this._orderRedemptions.get(opts.orderId);
		if (existing && existing !== v.code.code) {
			return { ok: false, error: 'already_used_in_order' };
		}
		this._orderRedemptions.set(opts.orderId, v.code.code);
		v.code.usageCount += 1;
		if (v.code.type === 'first_time') {
			this._firstTimeRedeemed.add(opts.parentEmail.toLowerCase());
		}
		return v;
	}

	/**
	 * Prune expired codes from the in-memory map. Run on every tick or
	 * lazily before validate(). Returns the number of codes evicted.
	 * The seeded BEDTIME10 first-time code never expires (no expiresAt),
	 * so it is exempt from this sweep.
	 */
	pruneExpired(grace = 0): number {
		const now = this._now();
		let evicted = 0;
		for (const [k, c] of this._codes.entries()) {
			if (c.expiresAt && now > c.expiresAt + grace) {
				this._codes.delete(k);
				evicted += 1;
			}
		}
		// Hard LRU cap: if we somehow grow past 100k codes, drop the oldest
		// non-first_time codes. Insertion order in a Map is creation order,
		// so the head of the iterator is the oldest.
		const HARD_CAP = 100_000;
		while (this._codes.size > HARD_CAP) {
			for (const [k, c] of this._codes.entries()) {
				if (c.type === "first_time") continue;
				this._codes.delete(k);
				evicted += 1;
				break;
			}
		}
		return evicted;
	}

	/** Snapshot helper for ops dashboards / tests. */
	snapshot(): { totalCodes: number; redeemedByType: Record<PromoType, number> } {
		const redeemedByType: Record<PromoType, number> = {
			first_time: 0,
			abandoned_cart: 0,
			birthday: 0,
			series_discount: 0,
		};
		for (const c of this._codes.values()) {
			if (c.usageCount > 0) redeemedByType[c.type] += c.usageCount;
		}
		return { totalCodes: this._codes.size, redeemedByType };
	}
}
