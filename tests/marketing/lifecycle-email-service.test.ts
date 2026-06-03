import { describe, expect, it } from 'vitest';
import {
	EmailGateService,
	LifecycleEmailService,
	LIFECYCLE_SCHEDULE,
	MockCrmClient,
} from '$lib/services/marketing';

const SECRET = 'test-secret-1234567890';

async function setupContact(gate: EmailGateService, email = 'p@example.com') {
	return gate.record({ email, shortcode: 'abcd1234', kidAgeBand: '4-6', themePicked: 'forest' });
}

describe('LifecycleEmailService', () => {
	it('uses the canonical 7-stage schedule', () => {
		expect(LIFECYCLE_SCHEDULE).toHaveLength(7);
		const templates = LIFECYCLE_SCHEDULE.map((s) => s.template);
		expect(templates).toEqual([
			'lifecycle_T0',
			'lifecycle_T1h',
			'lifecycle_T24h',
			'lifecycle_T72h',
			'lifecycle_T7d',
			'lifecycle_T14d',
			'lifecycle_T30d',
		]);
	});

	it('fires the T+0 email immediately on first tick', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		const r = await lc.tick();
		expect(r.sent).toBe(1);
		expect(crm.sentByTemplate('lifecycle_T0')).toHaveLength(1);
	});

	it('fires later stops when clock advances', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });

		await lc.tick(); // T+0
		now = 60 * 60 * 1000 + 1; // T+1h
		await lc.tick();
		now = 24 * 60 * 60 * 1000 + 1; // T+24h
		await lc.tick();

		expect(crm.sentByTemplate('lifecycle_T0')).toHaveLength(1);
		expect(crm.sentByTemplate('lifecycle_T1h')).toHaveLength(1);
		expect(crm.sentByTemplate('lifecycle_T24h')).toHaveLength(1);
	});

	it('attaches BEDTIME10 promo code in T+24h vars', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		now = 24 * 60 * 60 * 1000 + 1;
		await lc.tick();
		const t24 = crm.sentByTemplate('lifecycle_T24h')[0];
		expect(t24?.vars.promo_code).toBe('BEDTIME10');
	});

	it('does NOT re-send a template the contact already received (idempotent)', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		await lc.tick();
		await lc.tick();
		await lc.tick();
		expect(crm.sentByTemplate('lifecycle_T0')).toHaveLength(1);
	});

	it('stops sending when contact converts (paid_print)', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		await lc.tick();
		gate.advanceStage('p@example.com', 'paid_print');
		now = 24 * 60 * 60 * 1000 + 1;
		const r = await lc.tick();
		expect(r.skippedTerminal).toBe(1);
		expect(crm.sentByTemplate('lifecycle_T24h')).toHaveLength(0);
	});

	it('stops sending when contact unsubscribes from marketing', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		await lc.tick();
		gate.setUnsubscribed('p@example.com', 'marketing', true);
		now = 24 * 60 * 60 * 1000 + 1;
		const r = await lc.tick();
		expect(r.skippedUnsubscribed).toBe(1);
		expect(crm.sentByTemplate('lifecycle_T24h')).toHaveLength(0);
	});

	it('reports per-tick stats', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate, 'a@example.com');
		await setupContact(gate, 'b@example.com');
		gate.setUnsubscribed('b@example.com', 'marketing', true);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		const r = await lc.tick();
		expect(r.scanned).toBe(2);
		expect(r.sent).toBe(1);
		expect(r.skippedUnsubscribed).toBe(1);
	});

	it('builds shareable link with publicUrlBase', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({
			crm,
			gate,
			nowSource: () => now,
			publicUrlBase: 'https://storybook.example',
		});
		await lc.tick();
		const t0 = crm.sentByTemplate('lifecycle_T0')[0];
		expect(t0?.vars.link).toBe('https://storybook.example/r/abcd1234');
	});

	it('records failures without poisoning the contact', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		crm.forcedError = 'simulated network error';
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		const r1 = await lc.tick();
		expect(r1.failed).toBe(1);
		expect(r1.sent).toBe(0);

		crm.forcedError = undefined;
		const r2 = await lc.tick();
		// Retried — T+0 fired
		expect(r2.sent).toBe(1);
		expect(crm.sentByTemplate('lifecycle_T0')).toHaveLength(1);
	});

	it('sendNow fires immediately + marks the contact', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		const { contact } = await setupContact(gate);
		const crm = new MockCrmClient(() => now);
		const lc = new LifecycleEmailService({ crm, gate, nowSource: () => now });
		const ok = await lc.sendNow(contact, 'gate_unlock');
		expect(ok).toBe(true);
		expect(crm.sentByTemplate('gate_unlock')).toHaveLength(1);
	});
});
