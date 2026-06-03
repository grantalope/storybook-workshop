import { describe, expect, it } from 'vitest';
import {
	EDU_DRIP_CATALOG,
	EducationalDripService,
	EmailGateService,
	MockCrmClient,
} from '$lib/services/marketing';

const SECRET = 'test-secret-1234567890';

describe('EducationalDripService', () => {
	it('catalog covers all 10 evidence knobs', () => {
		const knobs = new Set(EDU_DRIP_CATALOG.map((e) => e.knob));
		expect(knobs.size).toBe(10);
		expect(knobs).toEqual(
			new Set([
				'personalized_hero',
				'story_grammar',
				'bedtime_repetition',
				'tier2_vocabulary',
				'dialogic_reading',
				'paired_picture_text',
				'emotional_pacing',
				'age_band_calibration',
				'predictable_repetition',
				'ehri_phase_alignment',
			]),
		);
	});

	it('catalog has at least 24 entries', () => {
		expect(EDU_DRIP_CATALOG.length).toBeGreaterThanOrEqual(24);
	});

	it('every entry has citation, body, and product tie', () => {
		for (const entry of EDU_DRIP_CATALOG) {
			expect(entry.id).toBeTruthy();
			expect(entry.knob).toBeTruthy();
			expect(entry.citation).toMatch(/\d{4}/);
			expect(entry.body.length).toBeGreaterThan(20);
			expect(entry.productTie.length).toBeGreaterThan(10);
		}
	});

	async function setup() {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const crm = new MockCrmClient(() => now);
		const svc = new EducationalDripService({
			crm,
			gate,
			nowSource: () => now,
			publicUrlBase: 'https://sw.example',
		});
		return {
			svc,
			crm,
			gate,
			setNow(v: number) {
				now = v;
			},
		};
	}

	it('subscribes a parent + fires entry 0 on first tick', async () => {
		const ctx = await setup();
		ctx.svc.subscribe('p@example.com');
		const r = await ctx.svc.tick();
		expect(r.sent).toBe(1);
		expect(ctx.crm.sentByTemplate('edu_drip_weekly')).toHaveLength(1);
		const tag = ctx.crm.sentByTemplate('edu_drip_weekly')[0]?.tags?.[0];
		expect(tag).toContain('edu:');
	});

	it('respects 7-day cadence', async () => {
		const ctx = await setup();
		ctx.svc.subscribe('p@example.com');
		await ctx.svc.tick();
		ctx.setNow(3 * 24 * 60 * 60 * 1000); // T+3d
		const r = await ctx.svc.tick();
		expect(r.skippedNotDue).toBe(1);
		ctx.setNow(8 * 24 * 60 * 60 * 1000); // T+8d
		const r2 = await ctx.svc.tick();
		expect(r2.sent).toBe(1);
	});

	it('rotates through the catalog', async () => {
		const ctx = await setup();
		ctx.svc.subscribe('p@example.com');
		// Fire 3 entries
		for (let i = 0; i < 3; i++) {
			ctx.setNow(i * 7 * 24 * 60 * 60 * 1000);
			await ctx.svc.tick();
		}
		const sent = ctx.crm.sentByTemplate('edu_drip_weekly');
		expect(sent).toHaveLength(3);
		const ids = sent.map((s) => s.tags?.[0]);
		expect(new Set(ids).size).toBe(3);
	});

	it('skips opted-out parents', async () => {
		const ctx = await setup();
		ctx.svc.subscribe('p@example.com');
		ctx.gate.setUnsubscribed('p@example.com', 'educational', true);
		const r = await ctx.svc.tick();
		expect(r.skippedOptedOut).toBe(1);
		expect(r.sent).toBe(0);
	});

	it('idempotent on subscribe', async () => {
		const ctx = await setup();
		ctx.svc.subscribe('p@example.com');
		ctx.svc.subscribe('p@example.com');
		const c = ctx.svc.cursorFor('p@example.com');
		expect(c?.nextIndex).toBe(0);
	});

	it('respects custom cadenceMs', async () => {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		await gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const crm = new MockCrmClient(() => now);
		const svc = new EducationalDripService({
			crm,
			gate,
			nowSource: () => now,
			cadenceMs: 1000,
		});
		svc.subscribe('p@example.com');
		await svc.tick();
		now = 1500;
		const r = await svc.tick();
		expect(r.sent).toBe(1);
	});

	it('catalogSize reports correctly', async () => {
		const ctx = await setup();
		expect(ctx.svc.catalogSize()).toBeGreaterThanOrEqual(24);
	});

	it('coveredKnobs returns set of all 10 evidence knobs', async () => {
		const ctx = await setup();
		expect(ctx.svc.coveredKnobs().size).toBe(10);
	});

	it('rejects empty catalog override', () => {
		const ctx = setupSync();
		expect(
			() =>
				new EducationalDripService({
					crm: ctx.crm,
					gate: ctx.gate,
					catalog: [],
				}),
		).toThrow();
	});

	function setupSync() {
		const gate = new EmailGateService({ serverSecret: SECRET });
		const crm = new MockCrmClient();
		return { gate, crm };
	}
});
