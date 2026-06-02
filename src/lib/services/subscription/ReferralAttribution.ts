// @graph-layer: private
// @rationale: private (aggregated counters; per-shortcode → originating-parent map is local-only)
//
// src/routes/dashboard/services/storybook-workshop/subscription/ReferralAttribution.ts
//
// Anonymous referral chain: shortcode → click → purchase attributed.
// On grandparent purchase via referral link: $5 credit to originating
// parent's account.
//
// Track only aggregate counts; no per-user PII linkage beyond the originating
// parent (so credit can be awarded). Conversions are recorded by paymentId,
// not by buyer identity.

import type {
	MailerProvider,
	ReferralClick,
	ReferralConversion,
	ReferralCredit,
} from './types';

// ---------------------------------------------------------------------------
// Constants (spec §8.4)
// ---------------------------------------------------------------------------

/** $5 credit cents per qualifying grandparent referral conversion. */
export const REFERRAL_CREDIT_CENTS = 500;
/** Length of the random shortcode portion (excluding any prefix). */
export const SHORTCODE_LENGTH = 8;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ReferralAttributionOpts {
	mailer: MailerProvider;
	nowSource?: () => number;
	codeGen?: () => string;
}

export class ReferralAttribution {
	/** shortcode → originating parent email. ONLY identity-linked map. */
	private _shortcodeToParent = new Map<string, string>();
	/** shortcode → click count (aggregate, no per-click identity). */
	private _clickCounts = new Map<string, number>();
	/** Per-shortcode conversion log (paymentId-keyed; no buyer PII). */
	private _conversions: ReferralConversion[] = [];
	/** Credits awarded (paid out to originating parents). */
	private _credits: ReferralCredit[] = [];
	/** Paymen IDs already accounted (idempotency on conversion record). */
	private _accountedPayments = new Set<string>();

	private _mailer: MailerProvider;
	private _now: () => number;
	private _codeGen: () => string;

	constructor(opts: ReferralAttributionOpts) {
		this._mailer = opts.mailer;
		this._now = opts.nowSource ?? (() => Date.now());
		this._codeGen = opts.codeGen ?? defaultShortcodeGen;
	}

	/**
	 * Mint a new shortcode tied to an originating parent email. Returns the
	 * shortcode. Repeat calls for the same parent mint distinct shortcodes
	 * (per-book-share generates a fresh code).
	 */
	mintShortcode(originatingParentEmail: string): string {
		validateEmail(originatingParentEmail);
		for (let i = 0; i < 100; i++) {
			const code = this._codeGen();
			if (!this._shortcodeToParent.has(code)) {
				this._shortcodeToParent.set(code, originatingParentEmail);
				this._clickCounts.set(code, 0);
				return code;
			}
		}
		throw new Error(`ReferralAttribution: failed to mint unique shortcode after 100 tries`);
	}

	/** Record a click on a shortcoded share link. Aggregate-only. */
	recordClick(shortcode: string): ReferralClick {
		if (!this._shortcodeToParent.has(shortcode)) {
			throw new Error(`ReferralAttribution: unknown shortcode ${shortcode}`);
		}
		this._clickCounts.set(shortcode, (this._clickCounts.get(shortcode) ?? 0) + 1);
		return { shortcode, clickedAt: this._now() };
	}

	/**
	 * Record a conversion (purchase attributable to a shortcode). Optional
	 * `isGiftPurchase` flag triggers credit award path.
	 *
	 * Idempotent on `paymentId`: replaying the same payment is a no-op.
	 */
	async recordConversion(opts: {
		shortcode: string;
		paymentId: string;
		purchaseCents: number;
		isGiftPurchase: boolean;
	}): Promise<{ conversion: ReferralConversion; credit?: ReferralCredit }> {
		if (!this._shortcodeToParent.has(opts.shortcode)) {
			throw new Error(`ReferralAttribution: unknown shortcode ${opts.shortcode}`);
		}
		if (this._accountedPayments.has(opts.paymentId)) {
			// Already booked — no-op
			const existing = this._conversions.find((c) => c.paymentId === opts.paymentId);
			if (existing) return { conversion: existing };
		}
		this._accountedPayments.add(opts.paymentId);
		const conversion: ReferralConversion = {
			shortcode: opts.shortcode,
			convertedAt: this._now(),
			paymentId: opts.paymentId,
			purchaseCents: opts.purchaseCents,
			isGiftPurchase: opts.isGiftPurchase,
		};
		this._conversions.push(conversion);

		let credit: ReferralCredit | undefined;
		if (opts.isGiftPurchase) {
			const originatingParent = this._shortcodeToParent.get(opts.shortcode)!;
			credit = {
				shortcode: opts.shortcode,
				originatingParentEmail: originatingParent,
				creditCents: REFERRAL_CREDIT_CENTS,
				awardedAt: this._now(),
				paymentId: opts.paymentId,
			};
			this._credits.push(credit);
			await this._mailer.send({
				to: originatingParent,
				kind: 'referral_credit_awarded',
				variables: {
					creditCents: String(REFERRAL_CREDIT_CENTS),
					shortcode: opts.shortcode,
				},
			});
		}
		return { conversion, credit };
	}

	/** Aggregate click count for a shortcode. */
	clickCount(shortcode: string): number {
		return this._clickCounts.get(shortcode) ?? 0;
	}

	/** All conversions for a shortcode. */
	conversionsFor(shortcode: string): ReferralConversion[] {
		return this._conversions.filter((c) => c.shortcode === shortcode);
	}

	/** Credits awarded to a specific parent. */
	creditsFor(parentEmail: string): ReferralCredit[] {
		return this._credits.filter((c) => c.originatingParentEmail === parentEmail);
	}

	/** Total credit cents owed to a parent. */
	totalCreditCentsFor(parentEmail: string): number {
		return this.creditsFor(parentEmail).reduce((sum, c) => sum + c.creditCents, 0);
	}

	snapshot(): {
		shortcodes: number;
		totalClicks: number;
		totalConversions: number;
		totalGiftConversions: number;
		totalCreditCents: number;
	} {
		let totalClicks = 0;
		for (const c of this._clickCounts.values()) totalClicks += c;
		const totalGiftConversions = this._conversions.filter((c) => c.isGiftPurchase).length;
		const totalCreditCents = this._credits.reduce((sum, c) => sum + c.creditCents, 0);
		return {
			shortcodes: this._shortcodeToParent.size,
			totalClicks,
			totalConversions: this._conversions.length,
			totalGiftConversions,
			totalCreditCents,
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEmail(email: string): void {
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error(`ReferralAttribution: invalid email "${email}"`);
	}
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function defaultShortcodeGen(): string {
	let out = '';
	for (let i = 0; i < SHORTCODE_LENGTH; i++) {
		out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return out;
}
