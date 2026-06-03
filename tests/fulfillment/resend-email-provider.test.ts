// tests/fulfillment/resend-email-provider.test.ts
//
// Spec: docs/specs/2026-05-24-design.md §5.7 + §8.7
// Goal: crm-resend (Real Resend CRM provider for transactional emails)
//
// Surface: ResendEmailProvider + buildEmailHandlersFromProvider + hooks.server
// `assertResendKeyOrBootWarn`. Tests use the canonical fulfillment fixtures.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	NoopEmailProvider,
	OrderLifecycleService,
	InMemoryOrderStore,
	ResendEmailProvider,
	ResendSendError,
	RESEND_API_URL,
	buildEmailHandlersFromProvider,
	resendSubjectFor,
	resendTextBodyFor,
	resendHtmlBodyFor,
	resendUnsubscribeUrl,
	type ResendAuditEntry,
	type EmailMessage,
} from '$lib/services/fulfillment';
import { makeOrder } from './fixtures';
import { assertResendKeyOrBootWarn } from '../../src/hooks.server';

interface FetchCall {
	url: string;
	init: RequestInit;
}

function makeFetchMock(responses: Array<Response | (() => Response | Promise<Response>) | Error>): {
	fn: typeof fetch;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	let idx = 0;
	const fn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
		calls.push({ url, init: init ?? {} });
		const next = responses[idx];
		idx += 1;
		if (next === undefined) {
			throw new Error(`fetch mock exhausted at call #${idx}`);
		}
		if (next instanceof Error) throw next;
		if (typeof next === 'function') return await next();
		return next;
	}) as typeof fetch;
	return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function textResponse(status: number, body: string): Response {
	return new Response(body, { status });
}

const BASE_OPTS = {
	apiKey: 're_test_KEY',
	from: 'Storybook Workshop <hello@storybook.example>',
	unsubscribeBaseUrl: 'https://storybook.example',
};

const STUB_AUDIT_SINK = () => undefined;

describe('ResendEmailProvider — construction', () => {
	it('throws if apiKey missing', () => {
		expect(() => new ResendEmailProvider({ ...BASE_OPTS, apiKey: '' })).toThrow(
			/apiKey required/,
		);
	});
	it('throws if from missing', () => {
		expect(() => new ResendEmailProvider({ ...BASE_OPTS, from: '' })).toThrow(/from required/);
	});
	it('throws if unsubscribeBaseUrl missing (CAN-SPAM)', () => {
		expect(() => new ResendEmailProvider({ ...BASE_OPTS, unsubscribeBaseUrl: '' })).toThrow(
			/unsubscribeBaseUrl required/,
		);
	});
});

describe('ResendEmailProvider — POST shape', () => {
	let auditCalls: ResendAuditEntry[];
	beforeEach(() => {
		auditCalls = [];
	});

	it('POSTs to https://api.resend.com/emails with Bearer auth + JSON body', async () => {
		const { fn, calls } = makeFetchMock([jsonResponse(200, { id: 'em_1' })]);
		const provider = new ResendEmailProvider({
			...BASE_OPTS,
			fetchImpl: fn,
			auditSink: (e) => {
				auditCalls.push(e);
			},
			sleep: async () => undefined,
		});
		const order = makeOrder({ id: 'ord_shape_1', parentEmail: 'parent@example.com' });
		await provider.send({ event: 'paid', order, to: 'parent@example.com' });

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(RESEND_API_URL);
		expect(calls[0].init.method).toBe('POST');
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer re_test_KEY');
		expect(headers['Content-Type']).toBe('application/json');

		const body = JSON.parse(calls[0].init.body as string);
		expect(body.from).toBe(BASE_OPTS.from);
		expect(body.to).toEqual(['parent@example.com']);
		expect(body.reply_to).toBe(BASE_OPTS.from); // defaults to from
		expect(body.subject).toBe(`Your storybook order ord_shape_1 is confirmed`);
		expect(typeof body.html).toBe('string');
		expect(typeof body.text).toBe('string');
		// CAN-SPAM headers
		expect(body.headers['List-Unsubscribe']).toContain('https://storybook.example/unsubscribe?email=');
		expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
		expect(body.headers['X-Order-Id']).toBe('ord_shape_1');
		expect(body.headers['X-Email-Event']).toBe('paid');
		// Tags
		expect(body.tags).toEqual([
			{ name: 'event', value: 'paid' },
			{ name: 'order_id', value: 'ord_shape_1' },
		]);

		expect(auditCalls).toHaveLength(1);
		expect(auditCalls[0]).toMatchObject({
			orderId: 'ord_shape_1',
			event: 'paid',
			to: 'parent@example.com',
			outcome: 'sent',
			httpStatus: 200,
			attempts: 1,
		});
	});

	it('honors replyTo override and trims trailing slashes on unsubscribeBaseUrl', async () => {
		const { fn, calls } = makeFetchMock([jsonResponse(200, { id: 'em_2' })]);
		const provider = new ResendEmailProvider({
			...BASE_OPTS,
			replyTo: 'support@storybook.example',
			unsubscribeBaseUrl: 'https://storybook.example///',
			fetchImpl: fn,
			sleep: async () => undefined,
		});
		await provider.send({
			event: 'shipped',
			order: makeOrder({ trackingUrl: 'https://carrier.example/abc' }),
			to: 'p@example.com',
		});
		const body = JSON.parse(calls[0].init.body as string);
		expect(body.reply_to).toBe('support@storybook.example');
		expect(body.headers['List-Unsubscribe']).toBe(
			'<https://storybook.example/unsubscribe?email=p%40example.com>',
		);
	});

	it('plain-text and HTML bodies include the unsubscribe footer', async () => {
		const order = makeOrder();
		const msg: EmailMessage = { event: 'delivered', order, to: 'parent@example.com' };
		const text = resendTextBodyFor(msg, BASE_OPTS.unsubscribeBaseUrl);
		const html = resendHtmlBodyFor(msg, BASE_OPTS.unsubscribeBaseUrl);
		expect(text).toContain('unsubscribe');
		expect(text).toContain('https://storybook.example/unsubscribe?email=parent%40example.com');
		expect(html).toContain('<a href=');
		expect(html).toContain('unsubscribe here');
		expect(resendUnsubscribeUrl('https://storybook.example/', 'a@b.c')).toBe(
			'https://storybook.example/unsubscribe?email=a%40b.c',
		);
	});

	it('subject and body templates exist for every EmailEventName', () => {
		const events = ['paid', 'printed', 'shipped', 'delivered', 'failed', 'refunded'] as const;
		const order = makeOrder();
		for (const ev of events) {
			expect(resendSubjectFor(ev, order.id)).toMatch(/\w/);
			const text = resendTextBodyFor({ event: ev, order, to: 'x@y.z' }, BASE_OPTS.unsubscribeBaseUrl);
			expect(text).toContain(order.id);
			const html = resendHtmlBodyFor({ event: ev, order, to: 'x@y.z' }, BASE_OPTS.unsubscribeBaseUrl);
			expect(html).toContain(order.id);
		}
	});
});

describe('ResendEmailProvider — retry on 5xx, bounded ≤3', () => {
	let sleepDelays: number[];
	let auditCalls: ResendAuditEntry[];

	beforeEach(() => {
		sleepDelays = [];
		auditCalls = [];
	});

	const makeProvider = (responses: Array<Response | (() => Response | Promise<Response>) | Error>) => {
		const { fn, calls } = makeFetchMock(responses);
		const provider = new ResendEmailProvider({
			...BASE_OPTS,
			fetchImpl: fn,
			auditSink: (e) => {
				auditCalls.push(e);
			},
			sleep: async (ms) => {
				sleepDelays.push(ms);
			},
			maxAttempts: 3,
			baseBackoffMs: 100,
		});
		return { provider, calls };
	};

	it('retries on 503 and succeeds on attempt 2', async () => {
		const { provider, calls } = makeProvider([
			textResponse(503, 'service unavailable'),
			jsonResponse(200, { id: 'em_ok' }),
		]);
		await provider.send({ event: 'paid', order: makeOrder(), to: 'x@y.z' });
		expect(calls).toHaveLength(2);
		expect(sleepDelays).toEqual([100]); // base × 2^0
		expect(auditCalls).toHaveLength(1);
		expect(auditCalls[0]).toMatchObject({ outcome: 'sent', attempts: 2 });
	});

	it('caps at maxAttempts (3) and audits failed_5xx', async () => {
		const { provider, calls } = makeProvider([
			textResponse(500, 'boom 1'),
			textResponse(502, 'boom 2'),
			textResponse(504, 'boom 3'),
		]);
		await expect(
			provider.send({ event: 'paid', order: makeOrder(), to: 'x@y.z' }),
		).rejects.toBeInstanceOf(ResendSendError);
		expect(calls).toHaveLength(3); // exactly maxAttempts
		expect(sleepDelays).toEqual([100, 200]); // exp backoff between 1→2 and 2→3
		expect(auditCalls).toHaveLength(1);
		expect(auditCalls[0]).toMatchObject({
			outcome: 'failed_5xx',
			attempts: 3,
			httpStatus: 504,
		});
	});

	it('retries on network errors up to maxAttempts then audits network_error', async () => {
		const { provider, calls } = makeProvider([
			new Error('ECONNRESET'),
			new Error('ECONNRESET'),
			new Error('ECONNRESET'),
		]);
		await expect(
			provider.send({ event: 'shipped', order: makeOrder(), to: 'x@y.z' }),
		).rejects.toBeInstanceOf(ResendSendError);
		expect(calls).toHaveLength(3);
		expect(sleepDelays).toEqual([100, 200]);
		expect(auditCalls[0]).toMatchObject({ outcome: 'network_error', attempts: 3 });
	});

	it('emits ResendSendError with kind=failed_5xx and exposes httpStatus', async () => {
		const { provider } = makeProvider([
			textResponse(500, 'boom 1'),
			textResponse(500, 'boom 2'),
			textResponse(500, 'boom 3'),
		]);
		try {
			await provider.send({ event: 'paid', order: makeOrder(), to: 'x@y.z' });
			throw new Error('expected send to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ResendSendError);
			const e = err as ResendSendError;
			expect(e.kind).toBe('failed_5xx');
			expect(e.attempts).toBe(3);
			expect(e.httpStatus).toBe(500);
		}
	});
});

describe('ResendEmailProvider — 4xx audit + no retry', () => {
	it('does NOT retry on 400 and audits rejected_4xx', async () => {
		const { fn, calls } = makeFetchMock([textResponse(422, 'invalid from address')]);
		const audit: ResendAuditEntry[] = [];
		const sleepDelays: number[] = [];
		const provider = new ResendEmailProvider({
			...BASE_OPTS,
			fetchImpl: fn,
			auditSink: (e) => {
				audit.push(e);
			},
			sleep: async (ms) => {
				sleepDelays.push(ms);
			},
		});
		await expect(
			provider.send({ event: 'paid', order: makeOrder(), to: 'x@y.z' }),
		).rejects.toMatchObject({ name: 'ResendSendError', kind: 'rejected_4xx' });
		expect(calls).toHaveLength(1);
		expect(sleepDelays).toHaveLength(0); // no backoff before bailing
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			outcome: 'rejected_4xx',
			httpStatus: 422,
			attempts: 1,
		});
		expect(audit[0].errorMessage).toContain('invalid from address');
	});

	it('audit-sink errors are swallowed (do not crash the send pipeline)', async () => {
		const { fn } = makeFetchMock([jsonResponse(200, { id: 'em_ok' })]);
		const provider = new ResendEmailProvider({
			...BASE_OPTS,
			fetchImpl: fn,
			auditSink: () => {
				throw new Error('audit blew up');
			},
		});
		await expect(
			provider.send({ event: 'paid', order: makeOrder(), to: 'x@y.z' }),
		).resolves.toBeUndefined();
	});

	it('rejects when msg.to is empty', async () => {
		const { fn } = makeFetchMock([]);
		const provider = new ResendEmailProvider({ ...BASE_OPTS, fetchImpl: fn });
		await expect(
			provider.send({ event: 'paid', order: makeOrder(), to: '' }),
		).rejects.toThrow(/msg.to required/);
	});
});

describe('buildEmailHandlersFromProvider — OrderLifecycleService wiring', () => {
	it('wires onPaid/onInProduction/onShipped/onDelivered/onFailed/onTerminalError to send()', async () => {
		const provider = new NoopEmailProvider();
		const sendSpy = vi.spyOn(provider, 'send');
		const handlers = buildEmailHandlersFromProvider(provider);
		const store = new InMemoryOrderStore();
		const lifecycle = new OrderLifecycleService({ store, handlers });
		const order = await lifecycle.create({
			id: 'ord_wired_1',
			kidId: 'kid_1',
			bookId: 'book_1',
			parentEmail: 'parent@example.com',
			format: 'hardcover-8x8',
			pages: 40,
			pdfHash: 'sha256-x',
			shippingAddress: {
				name: 'P',
				line1: '1 St',
				city: 'Portland',
				region: 'OR',
				postcode: '97205',
				country: 'US',
			},
			shippingOption: {
				name: 'Ground',
				shipSpeed: 'ground',
				costCents: 899,
				currency: 'USD',
				etaDays: 5,
				luluShippingLevel: 'GROUND',
			},
			bookCostCents: 2999,
			consentLog: {
				reviewedSpreads: true,
				understandsNonRefundable: true,
				pdfHash: 'sha256-x',
				timestampMs: 1_700_000_000_000,
			},
		});
		expect(order.state).toBe('pending_payment');

		await lifecycle.transition(order.id, 'paid', 'system');
		await lifecycle.transition(order.id, 'submitted_to_lulu', 'system'); // no email
		await lifecycle.transition(order.id, 'in_production', 'lulu');
		await lifecycle.transition(order.id, 'shipped', 'lulu');
		await lifecycle.transition(order.id, 'delivered', 'lulu');

		const events = sendSpy.mock.calls.map((c) => (c[0] as EmailMessage).event);
		// submitted_to_lulu intentionally has no email handler in the factory
		// (the spec emails are paid / printed / shipped / delivered / failed).
		expect(events).toEqual(['paid', 'printed', 'shipped', 'delivered']);
		// every event was addressed to order.parentEmail
		for (const call of sendSpy.mock.calls) {
			const msg = call[0] as EmailMessage;
			expect(msg.to).toBe('parent@example.com');
			expect(msg.order.id).toBe('ord_wired_1');
		}
	});

	it('per-state send() failures do NOT block lifecycle transitions', async () => {
		const failingProvider = {
			async send(_msg: EmailMessage) {
				throw new Error('vendor down');
			},
		};
		const loggerCalls: Array<{ msg: string; err: unknown }> = [];
		const handlers = buildEmailHandlersFromProvider(failingProvider, {
			logger: (msg, err) => loggerCalls.push({ msg, err }),
		});
		const store = new InMemoryOrderStore();
		const lifecycle = new OrderLifecycleService({ store, handlers });
		const order = await lifecycle.create({
			id: 'ord_swallow_1',
			kidId: 'kid_1',
			bookId: 'book_1',
			parentEmail: 'p@example.com',
			format: 'hardcover-8x8',
			pages: 40,
			pdfHash: 'sha256-x',
			shippingAddress: {
				name: 'P',
				line1: '1 St',
				city: 'Portland',
				region: 'OR',
				postcode: '97205',
				country: 'US',
			},
			shippingOption: {
				name: 'Ground',
				shipSpeed: 'ground',
				costCents: 899,
				currency: 'USD',
				etaDays: 5,
				luluShippingLevel: 'GROUND',
			},
			bookCostCents: 2999,
			consentLog: {
				reviewedSpreads: true,
				understandsNonRefundable: true,
				pdfHash: 'sha256-x',
				timestampMs: 1_700_000_000_000,
			},
		});
		await expect(lifecycle.transition(order.id, 'paid', 'system')).resolves.toMatchObject({
			state: 'paid',
		});
		expect(loggerCalls).toHaveLength(1);
		expect(loggerCalls[0].msg).toContain('email:paid');
		expect(loggerCalls[0].msg).toContain(order.id);
	});

	it('end-to-end: ResendEmailProvider through the handler fires fetch on paid', async () => {
		const { fn, calls } = makeFetchMock([
			jsonResponse(200, { id: 'em_paid' }),
		]);
		const provider = new ResendEmailProvider({ ...BASE_OPTS, fetchImpl: fn, auditSink: STUB_AUDIT_SINK });
		const handlers = buildEmailHandlersFromProvider(provider);
		const store = new InMemoryOrderStore();
		const lifecycle = new OrderLifecycleService({ store, handlers });
		await lifecycle.create({
			id: 'ord_e2e_1',
			kidId: 'kid_1',
			bookId: 'book_1',
			parentEmail: 'parent@example.com',
			format: 'hardcover-8x8',
			pages: 40,
			pdfHash: 'sha256-x',
			shippingAddress: {
				name: 'P',
				line1: '1 St',
				city: 'Portland',
				region: 'OR',
				postcode: '97205',
				country: 'US',
			},
			shippingOption: {
				name: 'Ground',
				shipSpeed: 'ground',
				costCents: 899,
				currency: 'USD',
				etaDays: 5,
				luluShippingLevel: 'GROUND',
			},
			bookCostCents: 2999,
			consentLog: {
				reviewedSpreads: true,
				understandsNonRefundable: true,
				pdfHash: 'sha256-x',
				timestampMs: 1_700_000_000_000,
			},
		});
		await lifecycle.transition('ord_e2e_1', 'paid', 'system');
		expect(calls).toHaveLength(1);
		const body = JSON.parse(calls[0].init.body as string);
		expect(body.headers['X-Email-Event']).toBe('paid');
		expect(body.to).toEqual(['parent@example.com']);
	});
});

describe('assertResendKeyOrBootWarn — hooks.server boot warning', () => {
	it('returns skipped:test_env when VITEST=true', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn({ VITEST: 'true' }, (m) => calls.push(m));
		expect(res).toEqual({ outcome: 'skipped', reason: 'test_env' });
		expect(calls).toHaveLength(0);
	});

	it('returns skipped:test_env when NODE_ENV=test', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn({ NODE_ENV: 'test' }, (m) => calls.push(m));
		expect(res.outcome).toBe('skipped');
		expect(calls).toHaveLength(0);
	});

	it('returns skipped:explicit_skip when STORYBOOK_SKIP_RESEND_BOOT_CHECK=1', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn(
			{ NODE_ENV: 'production', STORYBOOK_SKIP_RESEND_BOOT_CHECK: '1' },
			(m) => calls.push(m),
		);
		expect(res).toEqual({ outcome: 'skipped', reason: 'explicit_skip' });
		expect(calls).toHaveLength(0);
	});

	it('returns ok:key_present when RESEND_API_KEY is set', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn(
			{ NODE_ENV: 'production', RESEND_API_KEY: 're_live_xxx' },
			(m) => calls.push(m),
		);
		expect(res).toEqual({ outcome: 'ok', reason: 'key_present' });
		expect(calls).toHaveLength(0);
	});

	it('warns when RESEND_API_KEY missing in production (loud message)', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn({ NODE_ENV: 'production' }, (m) => calls.push(m));
		expect(res.outcome).toBe('warn');
		if (res.outcome === 'warn') {
			expect(res.reason).toBe('missing_in_prod');
			expect(res.hint).toContain('UNSET in production');
		}
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('UNSET in production');
	});

	it('warns when RESEND_API_KEY missing in dev (hint message)', () => {
		const calls: string[] = [];
		const res = assertResendKeyOrBootWarn({ NODE_ENV: 'development' }, (m) => calls.push(m));
		expect(res.outcome).toBe('warn');
		if (res.outcome === 'warn') {
			expect(res.reason).toBe('missing_in_dev');
		}
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('unset (dev)');
	});
});
