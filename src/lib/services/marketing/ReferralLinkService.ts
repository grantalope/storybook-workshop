// @graph-layer: private
// @rationale: private (referral shortcode → originating parent + credit balance)
//
// src/lib/services/marketing/ReferralLinkService.ts
//
// Marketing-side referral surface: per-shortcode click-tracking +
// conversion attribution + $5 credit to originating parent on
// grandparent-purchase conversion.
//
// Complements `services/subscription/ReferralAttribution` — that one
// owns the gift/subscription credit path; this one owns the marketing
// share-link path (every read-along link is a referral source).
//
// CSPRNG-derived shortcodes via $lib/services/subscription/secureRandom.
//
// Spec: docs/specs/2026-05-24-design.md §8.4

import { secureRandomString } from '$lib/services/subscription/secureRandom';
import type {
	CrmClient,
	ReferralClickRecord,
	ReferralConversionRecord,
	ReferralCreditRecord,
} from './types';

/** $5 credit per qualifying grandparent referral conversion. */
export const REFERRAL_CREDIT_CENTS = 500;
const SHORTCODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SHORTCODE_LENGTH = 10;

export interface ReferralLinkServiceOpts {
	crm: CrmClient;
	nowSource?: () => number;
	publicUrlBase?: string;
	codeGen?: () => string;
}

export class ReferralLinkService {
	private _shortcodes = new Map<string, string>();
	private _clicks: ReferralClickRecord[] = [];
	private _conversions: ReferralConversionRecord[] = [];
	private _credits: ReferralCreditRecord[] = [];
	private _accountedPayments = new Set<string>();

	constructor(private opts: ReferralLinkServiceOpts) {}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	private _gen(): string {
		if (this.opts.codeGen) return this.opts.codeGen();
		return secureRandomString(SHORTCODE_LENGTH, SHORTCODE_ALPHABET);
	}

	/** Mint a new shortcode for an originating parent's book. */
	mintShortcode(originatingParentEmail: string): string {
		this._validateEmail(originatingParentEmail);
		for (let i = 0; i < 100; i++) {
			const code = this._gen();
			if (!this._shortcodes.has(code)) {
				this._shortcodes.set(code, originatingParentEmail);
				return code;
			}
		}
		throw new Error('ReferralLinkService: failed to mint unique shortcode after 100 tries');
	}

	/** Compose the public-share URL for a shortcode. */
	shareUrl(shortcode: string): string {
		return `${this.opts.publicUrlBase ?? ''}/r/${shortcode}`;
	}

	/** Record a click. Aggregate-only — no per-click PII linkage. */
	recordClick(shortcode: string): ReferralClickRecord {
		if (!this._shortcodes.has(shortcode)) {
			throw new Error(`ReferralLinkService: unknown shortcode ${shortcode}`);
		}
		const record: ReferralClickRecord = {
			shortcode,
			clickedAt: this._now(),
		};
		this._clicks.push(record);
		return record;
	}

	/**
	 * Record a conversion. Idempotent on `paymentId`. When
	 * `isGrandparentPurchase` is true the originating parent earns a
	 * $5 credit + receives the `referral_credit_awarded` email.
	 */
	async recordConversion(opts: {
		shortcode: string;
		paymentId: string;
		purchaseCents: number;
		isGrandparentPurchase: boolean;
	}): Promise<{ conversion: ReferralConversionRecord; credit?: ReferralCreditRecord }> {
		const originating = this._shortcodes.get(opts.shortcode);
		if (!originating) {
			throw new Error(`ReferralLinkService: unknown shortcode ${opts.shortcode}`);
		}
		if (this._accountedPayments.has(opts.paymentId)) {
			const existing = this._conversions.find((c) => c.paymentId === opts.paymentId)!;
			return { conversion: existing };
		}
		this._accountedPayments.add(opts.paymentId);
		const conversion: ReferralConversionRecord = {
			shortcode: opts.shortcode,
			originatingParentEmail: originating,
			paymentId: opts.paymentId,
			purchaseCents: opts.purchaseCents,
			convertedAt: this._now(),
			isGrandparentPurchase: opts.isGrandparentPurchase,
		};
		this._conversions.push(conversion);

		let credit: ReferralCreditRecord | undefined;
		if (opts.isGrandparentPurchase) {
			credit = {
				shortcode: opts.shortcode,
				originatingParentEmail: originating,
				creditCents: REFERRAL_CREDIT_CENTS,
				paymentId: opts.paymentId,
				awardedAt: this._now(),
			};
			this._credits.push(credit);
			await this.opts.crm.send({
				template: 'referral_credit_awarded',
				to: originating,
				vars: {
					creditCents: String(REFERRAL_CREDIT_CENTS),
					shortcode: opts.shortcode,
					to_email: originating,
					link: this.shareUrl(opts.shortcode),
					unsubscribe_bucket: 'transactional',
				},
				tags: [`referral:${opts.shortcode}`],
			});
		}
		return { conversion, credit };
	}

	clickCount(shortcode: string): number {
		return this._clicks.filter((c) => c.shortcode === shortcode).length;
	}

	conversionsFor(shortcode: string): ReferralConversionRecord[] {
		return this._conversions.filter((c) => c.shortcode === shortcode);
	}

	creditsFor(parentEmail: string): ReferralCreditRecord[] {
		const norm = parentEmail.toLowerCase();
		return this._credits.filter((c) => c.originatingParentEmail.toLowerCase() === norm);
	}

	totalCreditCentsFor(parentEmail: string): number {
		return this.creditsFor(parentEmail).reduce((sum, c) => sum + c.creditCents, 0);
	}

	parentForShortcode(shortcode: string): string | undefined {
		return this._shortcodes.get(shortcode);
	}

	snapshot(): {
		shortcodes: number;
		clicks: number;
		conversions: number;
		giftConversions: number;
		creditCents: number;
	} {
		return {
			shortcodes: this._shortcodes.size,
			clicks: this._clicks.length,
			conversions: this._conversions.length,
			giftConversions: this._conversions.filter((c) => c.isGrandparentPurchase).length,
			creditCents: this._credits.reduce((s, c) => s + c.creditCents, 0),
		};
	}

	private _validateEmail(email: string): void {
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw new Error(`ReferralLinkService: invalid email "${email}"`);
		}
	}
}
