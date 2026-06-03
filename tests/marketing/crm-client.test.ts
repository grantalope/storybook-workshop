import { describe, expect, it, vi } from 'vitest';
import {
	MockCrmClient,
	ResendCrmProvider,
	PostmarkCrmProvider,
} from '$lib/services/marketing';

describe('MockCrmClient', () => {
	it('captures every send to its ring buffer', async () => {
		const c = new MockCrmClient();
		await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		await c.send({ template: 'lifecycle_T0', to: 'p@x.com', vars: {} });
		expect(c.sent).toHaveLength(2);
		expect(c.sentByTemplate('gate_unlock')).toHaveLength(1);
		expect(c.sentTo('p@x.com')).toHaveLength(2);
	});

	it('returns providerMessageId on success', async () => {
		const c = new MockCrmClient();
		const r = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r.ok).toBe(true);
		expect(r.providerMessageId).toMatch(/mock_/);
	});

	it('forcedError makes all sends fail until cleared', async () => {
		const c = new MockCrmClient();
		c.forcedError = 'simulated';
		const r = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r.ok).toBe(false);
		expect(r.error).toBe('simulated');
		c.clear();
		const r2 = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r2.ok).toBe(true);
	});
});

describe('ResendCrmProvider (mocked fetch — no real HTTP)', () => {
	it('rejects construction without apiKey/from', () => {
		expect(() => new ResendCrmProvider({ apiKey: '', from: 'x@x.com' })).toThrow();
		expect(() => new ResendCrmProvider({ apiKey: 'k', from: '' })).toThrow();
	});

	it('posts to https://api.resend.com/emails on send', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
		);
		const c = new ResendCrmProvider({ apiKey: 'k', from: 'a@x.com', fetchImpl });
		const r = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r.ok).toBe(true);
		expect(r.providerMessageId).toBe('msg_123');
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://api.resend.com/emails',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('reports non-2xx as { ok: false, error }', async () => {
		const fetchImpl = vi.fn(async () => new Response('rate-limited', { status: 429 }));
		const c = new ResendCrmProvider({ apiKey: 'k', from: 'a@x.com', fetchImpl });
		const r = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r.ok).toBe(false);
		expect(r.error).toContain('429');
	});

	it('reports thrown fetch as { ok: false, error }', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('econnrefused');
		});
		const c = new ResendCrmProvider({ apiKey: 'k', from: 'a@x.com', fetchImpl });
		const r = await c.send({ template: 'gate_unlock', to: 'p@x.com', vars: {} });
		expect(r.ok).toBe(false);
		expect(r.error).toContain('econnrefused');
	});
});

describe('PostmarkCrmProvider (mocked fetch)', () => {
	it('rejects construction without serverToken/from', () => {
		expect(() => new PostmarkCrmProvider({ serverToken: '', from: 'x@x.com' })).toThrow();
		expect(() => new PostmarkCrmProvider({ serverToken: 't', from: '' })).toThrow();
	});

	it('posts to api.postmarkapp.com/email on send', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ MessageID: 'mid-1' }), { status: 200 }),
		);
		const c = new PostmarkCrmProvider({ serverToken: 't', from: 'a@x.com', fetchImpl });
		const r = await c.send({
			template: 'gate_unlock',
			to: 'p@x.com',
			vars: {},
			tags: ['stage:gate_unlocked'],
		});
		expect(r.ok).toBe(true);
		expect(r.providerMessageId).toBe('mid-1');
		expect(fetchImpl).toHaveBeenCalled();
		const calls = fetchImpl.mock.calls as unknown as Array<[string, unknown]>;
		expect(calls.length).toBeGreaterThan(0);
		expect(calls[0][0]).toContain('postmarkapp.com');
	});
});
