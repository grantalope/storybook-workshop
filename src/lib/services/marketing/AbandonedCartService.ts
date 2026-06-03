// @graph-layer: private
// @rationale: private (cart abandonment → escalating promo + email)
//
// src/lib/services/marketing/AbandonedCartService.ts
//
// Tracks parents who reach Station 7 (checkout) but don't pay. Fires
// recovery emails at T+1h / T+24h / T+72h with escalating promo codes
// (5% / 10% / 15% off, single-promo-per-order enforced).
//
// Per-kid abandonment respected — multiple incomplete drafts from the
// same parent for the SAME kid don't spam (we identify by `kidId` +
// `parentEmail` + most recent `bookId`). A different kid's draft DOES
// receive its own recovery chain.
//
// Terminates on `resolve()` — caller (order POST endpoint webhook) calls
// `resolve(parentEmail, kidId)` after successful payment.
//
// Spec: docs/specs/2026-05-24-design.md §8.3

import type {
	AbandonedCart,
	AbandonedCartPromo,
	CrmClient,
	EmailTemplate,
} from './types';
import type { PromoCodeService } from './PromoCodeService';
import { mintUnsubToken } from './unsubToken';
import { renderEmail } from './EmailRenderer';
import type { EmailGateService } from './EmailGateService';

const HOUR = 60 * 60 * 1000;

interface RecoveryStep {
	template: EmailTemplate;
	offsetMs: number;
	pctOff: number;
}

/** Three-step escalating recovery schedule. */
export const ABANDONED_CART_SCHEDULE: RecoveryStep[] = [
	{ template: 'abandoned_cart_T1h', offsetMs: HOUR, pctOff: 5 },
	{ template: 'abandoned_cart_T24h', offsetMs: 24 * HOUR, pctOff: 10 },
	{ template: 'abandoned_cart_T72h', offsetMs: 72 * HOUR, pctOff: 15 },
];

export interface AbandonedCartServiceOpts {
	crm: CrmClient;
	promo: PromoCodeService;
	nowSource?: () => number;
	publicUrlBase?: string;
	/** Optional schedule override for tests (shorter ticks). */
	schedule?: RecoveryStep[];
	/** HMAC secret used to mint per-recipient unsubscribe tokens. */
	serverSecret?: string;
	/** Email-gate registry used to look up kid_name when present. */
	gate?: EmailGateService;
}

export interface CartTickReport {
	scanned: number;
	sent: number;
	skippedResolved: number;
	skippedAlreadySent: number;
	failed: number;
}

export class AbandonedCartService {
	private _carts = new Map<string, AbandonedCart>();
	private _promos: AbandonedCartPromo[] = [];
	private _schedule: RecoveryStep[];

	constructor(private opts: AbandonedCartServiceOpts) {
		this._schedule = opts.schedule ?? ABANDONED_CART_SCHEDULE;
	}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	private _key(parentEmail: string, kidId: string): string {
		return `${parentEmail.toLowerCase()}::${kidId}`;
	}

	/** Track a fresh Station-7 abandonment. Idempotent on quick re-entry. */
	track(opts: { parentEmail: string; kidId: string; bookId: string; bookCostCents: number }): AbandonedCart {
		const key = this._key(opts.parentEmail, opts.kidId);
		const now = this._now();
		const existing = this._carts.get(key);
		if (existing && !existing.resolved && now - existing.abandonedAt < 5 * 60 * 1000) {
			// recent re-entry — keep original abandonedAt to avoid spamming reset
			existing.bookId = opts.bookId;
			existing.bookCostCents = opts.bookCostCents;
			return existing;
		}
		const cart: AbandonedCart = {
			parentEmail: opts.parentEmail,
			kidId: opts.kidId,
			bookId: opts.bookId,
			abandonedAt: now,
			bookCostCents: opts.bookCostCents,
			resolved: false,
		};
		this._carts.set(key, cart);
		return cart;
	}

	/** Mark a cart resolved (caller invokes after payment webhook). */
	resolve(parentEmail: string, kidId: string): boolean {
		const key = this._key(parentEmail, kidId);
		const cart = this._carts.get(key);
		if (!cart) return false;
		cart.resolved = true;
		return true;
	}

	/** Snapshot of an active cart (test/debug). */
	getCart(parentEmail: string, kidId: string): AbandonedCart | undefined {
		return this._carts.get(this._key(parentEmail, kidId));
	}

	/** Promos minted so far (test/debug). */
	mintedPromos(): AbandonedCartPromo[] {
		return [...this._promos];
	}

	/** Tick: scan all active carts, fire any newly-due recovery emails. */
	async tick(): Promise<CartTickReport> {
		const report: CartTickReport = {
			scanned: 0,
			sent: 0,
			skippedResolved: 0,
			skippedAlreadySent: 0,
			failed: 0,
		};
		const now = this._now();
		for (const cart of this._carts.values()) {
			report.scanned += 1;
			if (cart.resolved) {
				report.skippedResolved += 1;
				continue;
			}
			const elapsed = now - cart.abandonedAt;
			const due = this._schedule.filter((s) => s.offsetMs <= elapsed);
			for (const step of due) {
				if (this._wasSent(cart, step.template)) {
					report.skippedAlreadySent += 1;
					continue;
				}
				const promo = this.opts.promo.mintAbandonedCartPromo({
					parentEmail: cart.parentEmail,
					cartId: this._key(cart.parentEmail, cart.kidId),
					pctOff: step.pctOff,
				});
				this._promos.push({
					code: promo.code,
					parentEmail: cart.parentEmail,
					cartId: this._key(cart.parentEmail, cart.kidId),
					pctOff: step.pctOff,
					createdAt: now,
				});
				const vars: Record<string, string> = {
					to_email: cart.parentEmail,
					link: `${this.opts.publicUrlBase ?? ''}/r/${cart.bookId}`,
					promo_code: promo.code,
					pct_off: String(step.pctOff),
					unsubscribe_bucket: 'marketing',
				};
				const contact = this.opts.gate?.getContact(cart.parentEmail);
				if (contact?.tags.kidFirstName) {
					vars.kid_name = contact.tags.kidFirstName;
				}
				if (this.opts.serverSecret) {
					vars.unsubscribe_token = await mintUnsubToken({
						email: cart.parentEmail,
						bucket: 'marketing',
						secret: this.opts.serverSecret,
					});
				}
				const rendered = renderEmail({ template: step.template, to: cart.parentEmail, vars });
				const send = await this.opts.crm.send({
					template: step.template,
					to: cart.parentEmail,
					vars,
					tags: [`recovery:${step.template}`],
					subject: rendered.subject,
					text: rendered.text,
					html: rendered.html,
				});
				if (send.ok) {
					cart.lastSentTemplate = step.template;
					report.sent += 1;
				} else {
					report.failed += 1;
				}
			}
		}
		return report;
	}

	private _wasSent(cart: AbandonedCart, template: EmailTemplate): boolean {
		const order: EmailTemplate[] = [
			'abandoned_cart_T1h',
			'abandoned_cart_T24h',
			'abandoned_cart_T72h',
		];
		if (!cart.lastSentTemplate) return false;
		return order.indexOf(template) <= order.indexOf(cart.lastSentTemplate);
	}
}
