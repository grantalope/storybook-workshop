// @graph-layer: private
// @rationale: private (parent email lifecycle = behavioral PII tier)
//
// src/lib/services/marketing/LifecycleEmailService.ts
//
// Time-based email lifecycle for gate-unlocked parents.
//
// Schedule per spec §8.2:
//   T+0     "Your book is ready" + share CTA              (lifecycle_T0)
//   T+1h    "Did you share it?" + grandparent angle       (lifecycle_T1h)
//   T+24h   "Make it a printed keepsake" + BEDTIME10      (lifecycle_T24h)
//   T+72h   "What if Grandma made this a series?"         (lifecycle_T72h)
//   T+7d    "5 things research says about reading"        (lifecycle_T7d)
//   T+14d   "Your book expires in 16 days"                (lifecycle_T14d)
//   T+30d   "We saved kid's profile, come back"           (lifecycle_T30d)
//
// Terminates on lifecycle stage = paid_print | series_subscribed |
// unsubscribed (lifecycle-tick stops firing anything for that contact).
//
// Tick runs idempotent: each (contact, template) pair fires AT MOST
// ONCE. Re-tick is safe. CRM client failure is logged but does NOT
// poison the contact — next tick will retry.
//
// Spec: docs/specs/2026-05-24-design.md §8.2

import type {
	CrmContact,
	EmailTemplate,
	LifecycleStep,
	CrmClient,
} from './types';
import type { EmailGateService } from './EmailGateService';
import { mintUnsubToken } from './unsubToken';
import { renderEmail } from './EmailRenderer';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Canonical 7-stage schedule. Other services import this constant. */
export const LIFECYCLE_SCHEDULE: LifecycleStep[] = [
	{ template: 'lifecycle_T0', offsetMs: 0 },
	{ template: 'lifecycle_T1h', offsetMs: HOUR },
	{ template: 'lifecycle_T24h', offsetMs: 24 * HOUR },
	{ template: 'lifecycle_T72h', offsetMs: 72 * HOUR },
	{ template: 'lifecycle_T7d', offsetMs: 7 * DAY },
	{ template: 'lifecycle_T14d', offsetMs: 14 * DAY },
	{ template: 'lifecycle_T30d', offsetMs: 30 * DAY },
];

export interface LifecycleEmailServiceOpts {
	crm: CrmClient;
	gate: EmailGateService;
	nowSource?: () => number;
	/** Optional override of the schedule (tests use shorter delays). */
	schedule?: LifecycleStep[];
	/** Public URL base used to construct read-along share links. */
	publicUrlBase?: string;
	/** HMAC secret used to mint per-recipient unsubscribe tokens. */
	serverSecret?: string;
}

export interface TickReport {
	scanned: number;
	sent: number;
	skippedTerminal: number;
	skippedUnsubscribed: number;
	skippedAlreadySent: number;
	failed: number;
}

export class LifecycleEmailService {
	private _schedule: LifecycleStep[];
	constructor(private opts: LifecycleEmailServiceOpts) {
		this._schedule = opts.schedule ?? LIFECYCLE_SCHEDULE;
	}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	/**
	 * Iterate all known contacts and fire any newly-due lifecycle emails.
	 * Returns an aggregate report. Caller (cron endpoint) should call this
	 * once per scheduled wake (default daily). Re-tick at sub-minute cadence
	 * is safe (idempotent).
	 */
	async tick(): Promise<TickReport> {
		const report: TickReport = {
			scanned: 0,
			sent: 0,
			skippedTerminal: 0,
			skippedUnsubscribed: 0,
			skippedAlreadySent: 0,
			failed: 0,
		};
		const contacts = this.opts.gate.allContacts();
		const now = this._now();
		for (const contact of contacts) {
			report.scanned += 1;
			if (this._isTerminal(contact)) {
				report.skippedTerminal += 1;
				continue;
			}
			if (contact.unsubscribed.marketing) {
				report.skippedUnsubscribed += 1;
				continue;
			}
			// Gate-unlock retry: the welcome email is fire-and-forget from the
			// email-gate POST endpoint. If the CRM provider quota was exhausted
			// or threw at that moment, the contact unlocked but never received
			// the welcome. The tick detects that gap (gate_unlocked stage + no
			// gate_unlock entry in templateLastSentAt) and retries here.
			if (
				contact.lifecycleStage === 'gate_unlocked' &&
				contact.templateLastSentAt['gate_unlock'] === undefined
			) {
				const result = await this._send(contact, 'gate_unlock');
				if (result.ok) {
					contact.templateLastSentAt['gate_unlock'] = now;
					report.sent += 1;
				} else {
					report.failed += 1;
				}
			}
			const due = this._dueSteps(contact, now);
			for (const step of due) {
				if (contact.templateLastSentAt[step.template] !== undefined) {
					report.skippedAlreadySent += 1;
					continue;
				}
				const result = await this._send(contact, step.template);
				if (result.ok) {
					contact.templateLastSentAt[step.template] = now;
					report.sent += 1;
				} else {
					report.failed += 1;
				}
			}
		}
		return report;
	}

	/**
	 * Force-fire a specific template for a contact. Used by the gate POST
	 * endpoint to send T+0 immediately (lifecycle tick won't have run yet
	 * on a millisecond-fresh contact).
	 */
	async sendNow(contact: CrmContact, template: EmailTemplate): Promise<boolean> {
		const result = await this._send(contact, template);
		if (result.ok) {
			contact.templateLastSentAt[template] = this._now();
		}
		return result.ok;
	}

	/** Templates a contact has already been sent (used in tests + analytics). */
	sentTemplatesFor(contact: CrmContact): EmailTemplate[] {
		return Object.keys(contact.templateLastSentAt) as EmailTemplate[];
	}

	private _isTerminal(contact: CrmContact): boolean {
		return (
			contact.lifecycleStage === 'paid_print' ||
			contact.lifecycleStage === 'series_subscribed' ||
			contact.lifecycleStage === 'unsubscribed'
		);
	}

	private _dueSteps(contact: CrmContact, now: number): LifecycleStep[] {
		const elapsed = now - contact.createdAt;
		return this._schedule.filter((s) => s.offsetMs <= elapsed);
	}

	private async _send(contact: CrmContact, template: EmailTemplate) {
		const vars = this._buildVars(contact, template);
		if (this.opts.serverSecret) {
			vars.unsubscribe_token = await mintUnsubToken({
				email: contact.email,
				bucket: vars.unsubscribe_bucket ?? 'marketing',
				secret: this.opts.serverSecret,
			});
		}
		const rendered = renderEmail({ template, to: contact.email, vars });
		try {
			return await this.opts.crm.send({
				template,
				to: contact.email,
				vars,
				tags: this._tagsForContact(contact),
				subject: rendered.subject,
				text: rendered.text,
				html: rendered.html,
			});
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}

	private _buildVars(contact: CrmContact, template: EmailTemplate): Record<string, string> {
		const base = this.opts.publicUrlBase ?? '';
		const sc = contact.lastShortcode ?? '';
		const link = sc ? `${base}/r/${sc}` : `${base}/`;
		const vars: Record<string, string> = {
			to_email: contact.email,
			email: contact.email,
			link,
			unsubscribe_bucket: 'marketing',
		};
		if (contact.tags.kidFirstName) {
			vars.kid_name = contact.tags.kidFirstName;
		}
		if (template === 'lifecycle_T24h') {
			vars.promo_code = 'BEDTIME10';
		}
		return vars;
	}

	private _tagsForContact(contact: CrmContact): string[] {
		const tags: string[] = [`stage:${contact.lifecycleStage}`];
		if (contact.tags.kidAgeBand) tags.push(`age:${contact.tags.kidAgeBand}`);
		if (contact.tags.themePicked) tags.push(`theme:${contact.tags.themePicked}`);
		if (contact.tags.lengthTier) tags.push(`length:${contact.tags.lengthTier}`);
		return tags;
	}
}
