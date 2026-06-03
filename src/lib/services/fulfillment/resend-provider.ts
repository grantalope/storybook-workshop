// @graph-layer: private
// @rationale: private (transactional-email side-effect surface — billing PII tier)
//
// src/lib/services/fulfillment/resend-provider.ts
//
// Real Resend transactional-email provider. Replaces the constructor-only
// sketch in TransactionalEmailProvider.ts with:
//   - HTML + plain-text bodies per order-state event (spec §5.7 + §8.7)
//   - CAN-SPAM-style unsubscribe footer on every message
//   - Retry on 5xx (≤3 attempts, exponential backoff)
//   - Audit-log + no-retry on 4xx (the server has already rejected us;
//     spinning will not help and might trip rate limits)
//   - Injectable fetch + audit + sleep boundary so tests exercise every
//     branch without touching the network
//
// Wire-up: `hooks.server.ts` boot-warns when RESEND_API_KEY is unset in
// production. `OrderLifecycleService` per-state handlers (`onPaid`,
// `onSubmitted`, ...) call `provider.send({ event, order, to })`.
//
// Spec: docs/specs/2026-05-24-design.md §5.7 + §8.7

import type {
	EmailEventName,
	EmailMessage,
	Order,
	TransactionalEmailProvider,
} from './types';
import type { LifecycleHandlers } from './OrderLifecycleService';

// ---------------------------------------------------------------------------
// Constructor opts
// ---------------------------------------------------------------------------

/** Audit boundary — tests inspect, production wires to OrderAuditService. */
export interface ResendAuditSink {
	(entry: ResendAuditEntry): void | Promise<void>;
}

export interface ResendAuditEntry {
	orderId: string;
	event: EmailEventName;
	to: string;
	outcome: 'sent' | 'rejected_4xx' | 'failed_5xx' | 'network_error';
	httpStatus?: number;
	errorMessage?: string;
	attempts: number;
	at: number;
}

/** Injection points — tests pass mocks. */
export interface ResendEmailProviderOpts {
	/** Resend API key (`re_...`). Required. */
	apiKey: string;
	/** RFC-5322 From address, e.g. `Storybook Workshop <hello@example.com>`. */
	from: string;
	/** Optional reply-to address. Defaults to `from`. */
	replyTo?: string;
	/** Base URL to render in the unsubscribe footer. Required for CAN-SPAM. */
	unsubscribeBaseUrl: string;
	/** Injectable fetch boundary (production: globalThis.fetch). */
	fetchImpl?: typeof fetch;
	/** Audit sink (production: OrderAuditService bridge). */
	auditSink?: ResendAuditSink;
	/** Now source for audit timestamps. */
	nowSource?: () => number;
	/** Sleep boundary (used between retries; tests inject no-op). */
	sleep?: (ms: number) => Promise<void>;
	/** Max retries on 5xx / network error. Spec ≤3 attempts total. */
	maxAttempts?: number;
	/** Initial backoff ms between retries (default 250ms; doubles each retry). */
	baseBackoffMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
export const RESEND_API_URL = 'https://api.resend.com/emails';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ResendEmailProvider implements TransactionalEmailProvider {
	private _apiKey: string;
	private _from: string;
	private _replyTo: string;
	private _unsubBaseUrl: string;
	private _fetch: typeof fetch;
	private _audit: ResendAuditSink;
	private _now: () => number;
	private _sleep: (ms: number) => Promise<void>;
	private _maxAttempts: number;
	private _baseBackoff: number;

	constructor(opts: ResendEmailProviderOpts) {
		if (!opts.apiKey) throw new Error('ResendEmailProvider: apiKey required');
		if (!opts.from) throw new Error('ResendEmailProvider: from required');
		if (!opts.unsubscribeBaseUrl) {
			throw new Error('ResendEmailProvider: unsubscribeBaseUrl required (CAN-SPAM)');
		}
		this._apiKey = opts.apiKey;
		this._from = opts.from;
		this._replyTo = opts.replyTo ?? opts.from;
		this._unsubBaseUrl = opts.unsubscribeBaseUrl.replace(/\/+$/, '');
		this._fetch = opts.fetchImpl ?? fetch;
		this._audit = opts.auditSink ?? (() => undefined);
		this._now = opts.nowSource ?? (() => Date.now());
		this._sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
		this._maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
		this._baseBackoff = Math.max(0, opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS);
	}

	async send(msg: EmailMessage): Promise<void> {
		if (!msg.to) throw new Error('ResendEmailProvider: msg.to required');
		const subject = subjectFor(msg.event, msg.order.id);
		const text = textBodyFor(msg, this._unsubBaseUrl);
		const html = htmlBodyFor(msg, this._unsubBaseUrl);
		const unsubUrl = buildUnsubscribeUrl(this._unsubBaseUrl, msg.to);
		const payload = {
			from: this._from,
			to: [msg.to],
			reply_to: this._replyTo,
			subject,
			html,
			text,
			headers: {
				// CAN-SPAM + RFC 8058: one-click unsubscribe support
				'List-Unsubscribe': `<${unsubUrl}>`,
				'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
				'X-Order-Id': msg.order.id,
				'X-Email-Event': msg.event,
			},
			tags: [
				{ name: 'event', value: msg.event },
				{ name: 'order_id', value: msg.order.id },
			],
		};
		const body = JSON.stringify(payload);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this._apiKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		};

		let attempts = 0;
		let lastError: Error | undefined;
		while (attempts < this._maxAttempts) {
			attempts += 1;
			let resp: Response;
			try {
				resp = await this._fetch(RESEND_API_URL, {
					method: 'POST',
					headers,
					body,
				});
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempts >= this._maxAttempts) {
					await this._recordAudit({
						orderId: msg.order.id,
						event: msg.event,
						to: msg.to,
						outcome: 'network_error',
						errorMessage: lastError.message,
						attempts,
						at: this._now(),
					});
					throw new ResendSendError(
						`Resend network error after ${attempts} attempts: ${lastError.message}`,
						{ attempts, kind: 'network_error', cause: lastError },
					);
				}
				await this._sleep(this._backoffFor(attempts));
				continue;
			}
			if (resp.status >= 200 && resp.status < 300) {
				await this._recordAudit({
					orderId: msg.order.id,
					event: msg.event,
					to: msg.to,
					outcome: 'sent',
					httpStatus: resp.status,
					attempts,
					at: this._now(),
				});
				return;
			}
			if (resp.status >= 400 && resp.status < 500) {
				// Client error — do NOT retry; audit + throw.
				const errBody = await safeReadText(resp);
				await this._recordAudit({
					orderId: msg.order.id,
					event: msg.event,
					to: msg.to,
					outcome: 'rejected_4xx',
					httpStatus: resp.status,
					errorMessage: errBody,
					attempts,
					at: this._now(),
				});
				throw new ResendSendError(
					`Resend rejected with ${resp.status}: ${errBody}`,
					{ attempts, kind: 'rejected_4xx', httpStatus: resp.status },
				);
			}
			// 5xx — retry with backoff if attempts remain.
			const errBody = await safeReadText(resp);
			lastError = new Error(`Resend ${resp.status}: ${errBody}`);
			if (attempts >= this._maxAttempts) {
				await this._recordAudit({
					orderId: msg.order.id,
					event: msg.event,
					to: msg.to,
					outcome: 'failed_5xx',
					httpStatus: resp.status,
					errorMessage: errBody,
					attempts,
					at: this._now(),
				});
				throw new ResendSendError(
					`Resend failed after ${attempts} attempts: ${lastError.message}`,
					{ attempts, kind: 'failed_5xx', httpStatus: resp.status, cause: lastError },
				);
			}
			await this._sleep(this._backoffFor(attempts));
		}
		// Unreachable — the loop above either returns or throws.
		throw new ResendSendError('Resend send loop exited unexpectedly', {
			attempts,
			kind: 'failed_5xx',
		});
	}

	_backoffFor(attempt: number): number {
		// attempts is 1-indexed; first retry uses base*1, second uses base*2, ...
		return this._baseBackoff * Math.pow(2, attempt - 1);
	}

	async _recordAudit(entry: ResendAuditEntry): Promise<void> {
		try {
			await this._audit(entry);
		} catch {
			// Audit failures must NOT crash the send pipeline.
		}
	}
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export interface ResendSendErrorMeta {
	readonly attempts: number;
	readonly kind: 'rejected_4xx' | 'failed_5xx' | 'network_error';
	readonly httpStatus?: number;
	readonly cause?: Error;
}

export class ResendSendError extends Error {
	public readonly attempts: number;
	public readonly kind: ResendSendErrorMeta['kind'];
	public readonly httpStatus?: number;
	public readonly cause?: Error;
	constructor(message: string, meta: ResendSendErrorMeta) {
		super(message);
		this.name = 'ResendSendError';
		this.attempts = meta.attempts;
		this.kind = meta.kind;
		this.httpStatus = meta.httpStatus;
		this.cause = meta.cause;
	}
}

// ---------------------------------------------------------------------------
// Body templates
// ---------------------------------------------------------------------------

export function subjectFor(event: EmailEventName, orderId: string): string {
	switch (event) {
		case 'paid':
			return `Your storybook order ${orderId} is confirmed`;
		case 'printed':
			return `Your storybook is being printed`;
		case 'shipped':
			return `Your storybook is on its way`;
		case 'delivered':
			return `Your storybook has arrived`;
		case 'failed':
			return `There was a problem with your order ${orderId}`;
		case 'refunded':
			return `Your refund for order ${orderId} has been issued`;
	}
}

function trackingLineText(order: Order): string {
	return order.trackingUrl
		? `Tracking: ${order.trackingUrl}`
		: `Tracking link will follow once the carrier scans the parcel.`;
}

function trackingLineHtml(order: Order): string {
	return order.trackingUrl
		? `<p>Track your parcel: <a href="${escapeHtml(order.trackingUrl)}">${escapeHtml(order.trackingUrl)}</a></p>`
		: `<p>Tracking link will follow once the carrier scans the parcel.</p>`;
}

export function textBodyFor(msg: EmailMessage, unsubBaseUrl: string): string {
	const { event, order } = msg;
	const lines: string[] = [];
	switch (event) {
		case 'paid':
			lines.push(`Thanks for your order!`);
			lines.push(``);
			lines.push(`We received your storybook order ${order.id}. The book is heading to our print partner shortly.`);
			break;
		case 'printed':
			lines.push(`Order ${order.id} is in production.`);
			lines.push(``);
			lines.push(`Your storybook is on the press at our print partner. We will email again once it ships.`);
			break;
		case 'shipped':
			lines.push(`Order ${order.id} just shipped.`);
			lines.push(``);
			lines.push(trackingLineText(order));
			break;
		case 'delivered':
			lines.push(`Order ${order.id} was marked delivered.`);
			lines.push(``);
			lines.push(`We hope it lands well. If anything looks off, reply within 30 days for our quality guarantee.`);
			break;
		case 'failed':
			lines.push(`There was a problem with order ${order.id}.`);
			lines.push(``);
			lines.push(`Our team is reviewing what went wrong and will be in touch shortly. If you were charged, the charge will be refunded.`);
			break;
		case 'refunded':
			lines.push(`A refund has been issued for order ${order.id}.`);
			lines.push(``);
			lines.push(`The refund should appear on your statement within 5-10 business days, depending on your bank.`);
			break;
	}
	lines.push(``);
	lines.push(`-- Storybook Workshop`);
	lines.push(unsubscribeFooterText(msg.to, unsubBaseUrl));
	return lines.join('\n');
}

export function htmlBodyFor(msg: EmailMessage, unsubBaseUrl: string): string {
	const { event, order } = msg;
	const blocks: string[] = [];
	blocks.push(`<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.45;max-width:560px;margin:0 auto;padding:24px;color:#222">`);
	switch (event) {
		case 'paid':
			blocks.push(`<h2 style="margin-top:0">Thanks for your order!</h2>`);
			blocks.push(`<p>We received your storybook order <strong>${escapeHtml(order.id)}</strong>. The book is heading to our print partner shortly.</p>`);
			break;
		case 'printed':
			blocks.push(`<h2 style="margin-top:0">Your storybook is being printed</h2>`);
			blocks.push(`<p>Order <strong>${escapeHtml(order.id)}</strong> is on the press at our print partner. We will email again once it ships.</p>`);
			break;
		case 'shipped':
			blocks.push(`<h2 style="margin-top:0">Your storybook is on its way</h2>`);
			blocks.push(`<p>Order <strong>${escapeHtml(order.id)}</strong> just shipped.</p>`);
			blocks.push(trackingLineHtml(order));
			break;
		case 'delivered':
			blocks.push(`<h2 style="margin-top:0">Your storybook has arrived</h2>`);
			blocks.push(`<p>Order <strong>${escapeHtml(order.id)}</strong> was marked delivered. We hope it lands well.</p>`);
			blocks.push(`<p>If anything looks off, reply within 30 days for our quality guarantee.</p>`);
			break;
		case 'failed':
			blocks.push(`<h2 style="margin-top:0">There was a problem with your order</h2>`);
			blocks.push(`<p>We hit a snag with order <strong>${escapeHtml(order.id)}</strong>. Our team is reviewing and will be in touch shortly.</p>`);
			blocks.push(`<p>If you were charged, the charge will be refunded.</p>`);
			break;
		case 'refunded':
			blocks.push(`<h2 style="margin-top:0">Your refund has been issued</h2>`);
			blocks.push(`<p>A refund has been issued for order <strong>${escapeHtml(order.id)}</strong>. It should appear on your statement within 5-10 business days, depending on your bank.</p>`);
			break;
	}
	blocks.push(unsubscribeFooterHtml(msg.to, unsubBaseUrl));
	blocks.push(`</body></html>`);
	return blocks.join('');
}

// ---------------------------------------------------------------------------
// Unsubscribe footer (CAN-SPAM)
// ---------------------------------------------------------------------------

export function buildUnsubscribeUrl(base: string, to: string): string {
	const root = base.replace(/\/+$/, '');
	return `${root}/unsubscribe?email=${encodeURIComponent(to)}`;
}

function unsubscribeFooterText(to: string, baseUrl: string): string {
	const url = buildUnsubscribeUrl(baseUrl, to);
	return [
		``,
		`---`,
		`This is a transactional email about your storybook order. You will only receive these while you have an active order.`,
		`To stop receiving any email from us, including marketing, visit: ${url}`,
	].join('\n');
}

function unsubscribeFooterHtml(to: string, baseUrl: string): string {
	const url = buildUnsubscribeUrl(baseUrl, to);
	return [
		`<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"/>`,
		`<p style="font-size:12px;color:#777">This is a transactional email about your storybook order. You will only receive these while you have an active order.</p>`,
		`<p style="font-size:12px;color:#777">To stop receiving any email from us, including marketing, <a href="${escapeHtml(url)}">unsubscribe here</a>.</p>`,
	].join('');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

async function safeReadText(resp: Response): Promise<string> {
	try {
		return (await resp.text()).slice(0, 1024);
	} catch {
		return `(unreadable body)`;
	}
}

// ---------------------------------------------------------------------------
// OrderLifecycleService handler factory
// ---------------------------------------------------------------------------

/**
 * Build a LifecycleHandlers binding that fires the matching order-state
 * email through the configured provider. Per-state failures are swallowed
 * (logged via console.warn) so a flaky email vendor never blocks an order
 * transition — the audit log captures the failure for ops follow-up.
 */
export function buildEmailHandlersFromProvider(
	provider: TransactionalEmailProvider,
	opts: { logger?: (msg: string, err: unknown) => void } = {},
): LifecycleHandlers {
	const log = opts.logger ?? defaultEmailLogger;
	const sendSafe = async (event: EmailEventName, order: Order) => {
		try {
			await provider.send({ event, order, to: order.parentEmail });
		} catch (err) {
			log(`[email:${event}] order=${order.id} send failed`, err);
		}
	};
	return {
		onPaid: (order) => sendSafe('paid', order),
		onInProduction: (order) => sendSafe('printed', order),
		onShipped: (order) => sendSafe('shipped', order),
		onDelivered: (order) => sendSafe('delivered', order),
		onFailed: (order) => sendSafe('failed', order),
		onTerminalError: (order) => sendSafe('failed', order),
	};
}

function defaultEmailLogger(msg: string, err: unknown): void {
	// eslint-disable-next-line no-console
	console.warn(msg, err);
}
