// @graph-layer: private
// @rationale: private (per-bucket opt-out; GDPR delete cascade)
//
// src/lib/services/marketing/UnsubscribeService.ts
//
// Per-template / per-bucket GDPR-clean unsubscribe. Unsubscribe links in
// every marketing or educational email carry `?email=<email>&type=<bucket>`
// (see CrmClient.footerFor). The HTTP endpoint hits this service.
//
// Buckets per spec §8.2:
//   - transactional: order confirmations, shipping updates (cannot
//                    fully disable while account active; only delete-
//                    account cascades).
//   - marketing:    lifecycle + abandoned-cart. Also cascade-disables
//                   educational (a user who opts out of marketing
//                   doesn't want a different stream of "research
//                   emails" either).
//   - educational:  weekly research drip.
//
// Full-account delete (called from /library per-kid + per-account delete
// button) cascades to CrmContact deletion + Referral conversion records
// remain anonymous.
//
// Spec: docs/specs/2026-05-24-design.md §8.2 footer rules

import type { UnsubscribeBucket } from './types';
import type { EmailGateService } from './EmailGateService';

export interface UnsubscribeServiceOpts {
	gate: EmailGateService;
	nowSource?: () => number;
}

export interface UnsubscribeResult {
	ok: boolean;
	email: string;
	bucket: UnsubscribeBucket;
	cascaded?: UnsubscribeBucket[];
	error?: 'unknown_email' | 'invalid_bucket';
}

export class UnsubscribeService {
	constructor(private opts: UnsubscribeServiceOpts) {}

	unsubscribe(email: string, bucket: string): UnsubscribeResult {
		if (!this._isValidBucket(bucket)) {
			return {
				ok: false,
				email,
				bucket: 'marketing',
				error: 'invalid_bucket',
			};
		}
		const contact = this.opts.gate.getContact(email);
		if (!contact) {
			return { ok: false, email, bucket, error: 'unknown_email' };
		}
		this.opts.gate.setUnsubscribed(email, bucket, true);
		const cascaded: UnsubscribeBucket[] = [];
		// Marketing opt-out cascades to educational (avoid an end-run).
		if (bucket === 'marketing' && contact.unsubscribed.educational) {
			cascaded.push('educational');
		}
		// If parent explicitly opts out of EVERYTHING, advance lifecycle stage.
		const after = this.opts.gate.getContact(email);
		if (
			after &&
			after.unsubscribed.marketing &&
			after.unsubscribed.educational &&
			after.lifecycleStage !== 'paid_print' &&
			after.lifecycleStage !== 'series_subscribed'
		) {
			this.opts.gate.advanceStage(email, 'unsubscribed');
		}
		return { ok: true, email, bucket, cascaded };
	}

	/** Re-subscribe to a bucket (test/admin helper). */
	resubscribe(email: string, bucket: string): UnsubscribeResult {
		if (!this._isValidBucket(bucket)) {
			return { ok: false, email, bucket: 'marketing', error: 'invalid_bucket' };
		}
		const contact = this.opts.gate.getContact(email);
		if (!contact) return { ok: false, email, bucket, error: 'unknown_email' };
		this.opts.gate.setUnsubscribed(email, bucket, false);
		return { ok: true, email, bucket };
	}

	/** Full-account GDPR delete cascade. Caller is /library delete-account. */
	deleteAccount(email: string): boolean {
		return this.opts.gate.deleteContact(email);
	}

	private _isValidBucket(bucket: string): bucket is UnsubscribeBucket {
		return bucket === 'transactional' || bucket === 'marketing' || bucket === 'educational';
	}
}
