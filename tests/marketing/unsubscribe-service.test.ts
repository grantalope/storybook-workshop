import { describe, expect, it } from 'vitest';
import {
	EmailGateService,
	UnsubscribeService,
} from '$lib/services/marketing';

const SECRET = 'test-secret-1234567890';

describe('UnsubscribeService', () => {
	async function setup() {
		const gate = new EmailGateService({ serverSecret: SECRET });
		await gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const svc = new UnsubscribeService({ gate });
		return { gate, svc };
	}

	it('unsubscribes from marketing', async () => {
		const { gate, svc } = await setup();
		const r = svc.unsubscribe('p@example.com', 'marketing');
		expect(r.ok).toBe(true);
		expect(gate.getContact('p@example.com')?.unsubscribed.marketing).toBe(true);
	});

	it('marketing opt-out cascades to educational', async () => {
		const { gate, svc } = await setup();
		svc.unsubscribe('p@example.com', 'marketing');
		expect(gate.getContact('p@example.com')?.unsubscribed.educational).toBe(true);
	});

	it('marketing+educational opt-out advances lifecycle stage to unsubscribed', async () => {
		const { gate, svc } = await setup();
		svc.unsubscribe('p@example.com', 'marketing');
		expect(gate.getContact('p@example.com')?.lifecycleStage).toBe('unsubscribed');
	});

	it('refuses invalid bucket', async () => {
		const { svc } = await setup();
		const r = svc.unsubscribe('p@example.com', 'invalid-bucket');
		expect(r.ok).toBe(false);
		expect(r.error).toBe('invalid_bucket');
	});

	it('refuses unknown email', async () => {
		const { svc } = await setup();
		const r = svc.unsubscribe('ghost@example.com', 'marketing');
		expect(r.ok).toBe(false);
		expect(r.error).toBe('unknown_email');
	});

	it('does NOT downgrade paid_print contacts to unsubscribed', async () => {
		const { gate, svc } = await setup();
		gate.advanceStage('p@example.com', 'paid_print');
		svc.unsubscribe('p@example.com', 'marketing');
		expect(gate.getContact('p@example.com')?.lifecycleStage).toBe('paid_print');
	});

	it('re-subscribes a bucket', async () => {
		const { gate, svc } = await setup();
		svc.unsubscribe('p@example.com', 'marketing');
		const r = svc.resubscribe('p@example.com', 'marketing');
		expect(r.ok).toBe(true);
		expect(gate.getContact('p@example.com')?.unsubscribed.marketing).toBe(false);
	});

	it('deleteAccount removes the contact entirely', async () => {
		const { gate, svc } = await setup();
		expect(svc.deleteAccount('p@example.com')).toBe(true);
		expect(gate.getContact('p@example.com')).toBeUndefined();
	});

	it('unsubscribe from educational only keeps marketing on', async () => {
		const { gate, svc } = await setup();
		svc.unsubscribe('p@example.com', 'educational');
		expect(gate.getContact('p@example.com')?.unsubscribed.educational).toBe(true);
		expect(gate.getContact('p@example.com')?.unsubscribed.marketing).toBe(false);
	});

	it('unsubscribe from transactional records the flag but contact remains active', async () => {
		const { gate, svc } = await setup();
		svc.unsubscribe('p@example.com', 'transactional');
		expect(gate.getContact('p@example.com')?.unsubscribed.transactional).toBe(true);
	});
});
