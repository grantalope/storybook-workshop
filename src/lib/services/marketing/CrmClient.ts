// @graph-layer: private
// @rationale: private (outbound email — billing/marketing PII tier)
//
// src/lib/services/marketing/CrmClient.ts
//
// Provider-agnostic CRM email client. The marketing-funnel services
// (LifecycleEmailService, AbandonedCartService, EducationalDripService,
// EmailGateService) all depend on this interface, not on a specific
// vendor SDK.
//
// Default production provider is Resend (per CLAUDE.md cross-deps note);
// Postmark is a 1-line swap. Both providers are COPPA-K compliant and
// GDPR-safe — the marketing funnel never sends kid photos or rendered
// book interiors, only the shareable-link shortcode.
//
// In tests we use `MockCrmClient` which captures every send() call to
// an in-memory ring buffer (no real HTTP). Production wiring picks
// `ResendCrmProvider` reading `RESEND_API_KEY` from env.
//
// Spec: docs/specs/2026-05-24-design.md §8.7

import type { CrmClient, CrmSendOpts, CrmSendResult, EmailTemplate } from './types';

// ---------------------------------------------------------------------------
// Mock provider — default for tests + dev
// ---------------------------------------------------------------------------

export class MockCrmClient implements CrmClient {
	/** Captured sends. Tests assert against this list. */
	public readonly sent: Array<CrmSendOpts & { sentAt: number }> = [];
	/** When set, every send() returns this — drives error-path tests. */
	public forcedError?: string;

	constructor(private nowSource: () => number = () => Date.now()) {}

	async send(opts: CrmSendOpts): Promise<CrmSendResult> {
		if (this.forcedError) {
			return { ok: false, error: this.forcedError };
		}
		this.sent.push({ ...opts, sentAt: this.nowSource() });
		return { ok: true, providerMessageId: `mock_${this.sent.length}` };
	}

	/** Convenience: sends targeted at a specific template. */
	sentByTemplate(template: EmailTemplate): CrmSendOpts[] {
		return this.sent.filter((s) => s.template === template);
	}

	/** Convenience: sends targeted at a specific email. */
	sentTo(email: string): CrmSendOpts[] {
		return this.sent.filter((s) => s.to === email);
	}

	clear(): void {
		this.sent.length = 0;
		this.forcedError = undefined;
	}
}

// ---------------------------------------------------------------------------
// Resend provider — default production stub (no real HTTP in tests)
// ---------------------------------------------------------------------------

export interface ResendCrmProviderOpts {
	apiKey: string;
	from: string;
	/** Optional fetch impl — injected in tests. Defaults to globalThis.fetch. */
	fetchImpl?: typeof fetch;
}

/**
 * Resend HTTP client. Posts to `https://api.resend.com/emails`. Returns
 * `{ ok: true, providerMessageId }` on 2xx, `{ ok: false, error }` otherwise.
 *
 * We do NOT pull in the `resend` npm package — staying on raw fetch keeps
 * the dependency surface narrow and lets us mock the boundary cleanly.
 */
export class ResendCrmProvider implements CrmClient {
	constructor(private opts: ResendCrmProviderOpts) {
		if (!opts.apiKey) {
			throw new Error('ResendCrmProvider: apiKey is required');
		}
		if (!opts.from) {
			throw new Error('ResendCrmProvider: from is required');
		}
	}

	async send(opts: CrmSendOpts): Promise<CrmSendResult> {
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		try {
			const res = await fetchImpl('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.opts.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from: this.opts.from,
					to: opts.to,
					subject: subjectFor(opts.template, opts.vars),
					text: textFor(opts.template, opts.vars),
					tags: (opts.tags ?? []).map((t) => ({ name: 'tag', value: t })),
				}),
			});
			if (!res.ok) {
				return { ok: false, error: `Resend HTTP ${res.status}` };
			}
			const body = (await res.json().catch(() => ({}))) as { id?: string };
			return { ok: true, providerMessageId: body.id };
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}
}

// ---------------------------------------------------------------------------
// Postmark provider — drop-in alternative
// ---------------------------------------------------------------------------

export interface PostmarkCrmProviderOpts {
	serverToken: string;
	from: string;
	fetchImpl?: typeof fetch;
}

export class PostmarkCrmProvider implements CrmClient {
	constructor(private opts: PostmarkCrmProviderOpts) {
		if (!opts.serverToken) {
			throw new Error('PostmarkCrmProvider: serverToken is required');
		}
		if (!opts.from) {
			throw new Error('PostmarkCrmProvider: from is required');
		}
	}

	async send(opts: CrmSendOpts): Promise<CrmSendResult> {
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		try {
			const res = await fetchImpl('https://api.postmarkapp.com/email', {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-Postmark-Server-Token': this.opts.serverToken,
				},
				body: JSON.stringify({
					From: this.opts.from,
					To: opts.to,
					Subject: subjectFor(opts.template, opts.vars),
					TextBody: textFor(opts.template, opts.vars),
					MessageStream: 'outbound',
					Tag: (opts.tags ?? []).join(','),
				}),
			});
			if (!res.ok) {
				return { ok: false, error: `Postmark HTTP ${res.status}` };
			}
			const body = (await res.json().catch(() => ({}))) as { MessageID?: string };
			return { ok: true, providerMessageId: body.MessageID };
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers: subjects + plain-text bodies
// ---------------------------------------------------------------------------

/** Public so EmailRenderer + tests can share the subject-line map. */
export function subjectFor(template: EmailTemplate, vars: Record<string, string>): string {
	const name = vars.kid_name ?? 'your kid';
	switch (template) {
		case 'gate_unlock':
			return `Your storybook for ${name} is ready`;
		case 'lifecycle_T0':
			return `Your book starring ${name} is live`;
		case 'lifecycle_T1h':
			return `Did you share ${name}'s book yet?`;
		case 'lifecycle_T24h':
			return `${name}'s book in print + free shipping (BEDTIME10)`;
		case 'lifecycle_T72h':
			return `What if Grandma made this a series?`;
		case 'lifecycle_T7d':
			return `5 research-backed reading tips for ${name}`;
		case 'lifecycle_T14d':
			return `${name}'s book expires in 16 days`;
		case 'lifecycle_T30d':
			return `We saved ${name}'s profile — come back any time`;
		case 'abandoned_cart_T1h':
			return `You were one click away — here's 5% off`;
		case 'abandoned_cart_T24h':
			return `Still thinking about ${name}'s book? 10% off`;
		case 'abandoned_cart_T72h':
			return `Last call: 15% off ${name}'s book`;
		case 'birthday_6w':
			return `${name}'s birthday is in 6 weeks`;
		case 'edu_drip_weekly':
			return vars.subject ?? 'Reading research for your week';
		case 'referral_credit_awarded':
			return `You earned a $5 credit`;
	}
}

/** Public for tests + EmailRenderer's plain-text fallback. */
export function textFor(template: EmailTemplate, vars: Record<string, string>): string {
	const link = vars.link ?? '';
	const name = vars.kid_name ?? 'your kid';
	const promo = vars.promo_code ? ` (use code ${vars.promo_code})` : '';
	const baseFooter = footerFor(vars);
	let body: string;
	switch (template) {
		case 'gate_unlock':
			body = `Welcome! ${name}'s book is unlocked. Read along: ${link}`;
			break;
		case 'lifecycle_T0':
			body = `${name}'s book is ready. Share with grandparents: ${link}`;
			break;
		case 'lifecycle_T1h':
			body = `Did you share ${name}'s book yet? Grandparents love a heads-up: ${link}`;
			break;
		case 'lifecycle_T24h':
			body = `Make ${name}'s storybook a hardcover keepsake — free shipping with BEDTIME10${promo}. ${link}`;
			break;
		case 'lifecycle_T72h':
			body = `What if Grandma made this a series for ${name}? ${link}`;
			break;
		case 'lifecycle_T7d':
			body = vars.body ?? `5 research-backed reading tips. ${link}`;
			break;
		case 'lifecycle_T14d':
			body = `${name}'s digital book expires in 16 days. Save the PDF or print it: ${link}`;
			break;
		case 'lifecycle_T30d':
			body = `We saved ${name}'s profile. Come back any time: ${link}`;
			break;
		case 'abandoned_cart_T1h':
			body = `You were one click away. Here's 5% off${promo}. ${link}`;
			break;
		case 'abandoned_cart_T24h':
			body = `Still thinking about ${name}'s book? 10% off${promo}. ${link}`;
			break;
		case 'abandoned_cart_T72h':
			body = `Last call — 15% off${promo}. ${link}`;
			break;
		case 'birthday_6w':
			body = `${name}'s birthday is in 6 weeks. Make it her best year: ${link}`;
			break;
		case 'edu_drip_weekly':
			body = vars.body ?? `Reading research for your week: ${link}`;
			break;
		case 'referral_credit_awarded':
			body = `Your share converted — $${(parseInt(vars.creditCents ?? '500', 10) / 100).toFixed(
				2,
			)} credit on your next book. ${link}`;
			break;
	}
	return `${body}\n\n${baseFooter}`;
}

/** GDPR + per-bucket unsubscribe footer. */
export function footerFor(vars: Record<string, string>): string {
	const email = vars.to_email ?? vars.email ?? '';
	const bucket = vars.unsubscribe_bucket ?? 'marketing';
	const unsubBase = vars.unsubscribe_base ?? '/api/marketing/unsubscribe';
	const link = `${unsubBase}?email=${encodeURIComponent(email)}&type=${bucket}`;
	return [
		`---`,
		`Storybook Workshop · privacy on-device · COPPA-K compliant`,
		`Unsubscribe from ${bucket} emails: ${link}`,
		`You will continue to receive transactional emails (order confirmations, shipping) unless you delete your account.`,
	].join('\n');
}
