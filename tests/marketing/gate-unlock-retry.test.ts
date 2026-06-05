// tests/marketing/gate-unlock-retry.test.ts
//
// Regression test for blocker #5: gate_unlock welcome email is
// fire-and-forget from the email-gate POST endpoint. If the CRM provider
// quota is exhausted or throws at that moment, the user gets the cookie
// + unlocked read-along but never receives the welcome. The lifecycle
// tick must detect that gap and retry — otherwise the user is silently
// stuck without their welcome forever.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	EmailGateService,
	LifecycleEmailService,
	type CrmClient,
	type CrmSendOpts,
	type CrmSendResult,
} from '$lib/services/marketing';

const SECRET = 'test-secret-1234567890';

class FlakyCrm implements CrmClient {
	public failNext = 0;
	public sent: CrmSendOpts[] = [];
	async send(opts: CrmSendOpts): Promise<CrmSendResult> {
		if (this.failNext > 0) {
			this.failNext--;
			return { ok: false, error: 'quota_exhausted' };
		}
		this.sent.push(opts);
		return { ok: true, providerMessageId: 'mid_' + this.sent.length };
	}
}

class ThrowingCrm implements CrmClient {
	public throwNext = 0;
	public sent: CrmSendOpts[] = [];
	async send(opts: CrmSendOpts): Promise<CrmSendResult> {
		if (this.throwNext > 0) {
			this.throwNext--;
			throw new Error('econnrefused');
		}
		this.sent.push(opts);
		return { ok: true, providerMessageId: 'mid_' + this.sent.length };
	}
}

describe('lifecycle tick retries failed gate_unlock', () => {
	function setup(crm: CrmClient) {
		let now = 0;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
		const lifecycle = new LifecycleEmailService({
			crm,
			gate,
			nowSource: () => now,
			serverSecret: SECRET,
		});
		return {
			gate,
			lifecycle,
			get now() { return now; },
			setNow(v: number) { now = v; },
		};
	}

	it('tick re-sends gate_unlock when first attempt returned ok:false', async () => {
		const crm = new FlakyCrm();
		const ctx = setup(crm);
		const rec = await ctx.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		// Simulate the gate POST endpoint firing sendNow() — quota exhausted.
		crm.failNext = 1;
		const first = await ctx.lifecycle.sendNow(rec.contact, 'gate_unlock');
		expect(first).toBe(false);
		expect(crm.sent.length).toBe(0);
		// Lifecycle tick should detect the missing gate_unlock send and retry.
		// Advance enough to also satisfy the T0 offset (0ms) — both should fire.
		ctx.setNow(1);
		const report = await ctx.lifecycle.tick();
		// One send for gate_unlock retry + one for lifecycle_T0 (offset 0ms).
		expect(report.sent).toBeGreaterThanOrEqual(1);
		const templates = crm.sent.map((s) => s.template);
		expect(templates).toContain('gate_unlock');
	});

	it('tick re-sends gate_unlock when first attempt THREW', async () => {
		const crm = new ThrowingCrm();
		const ctx = setup(crm);
		const rec = await ctx.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		// First attempt throws inside the CRM — sendNow swallows via _send catch.
		crm.throwNext = 1;
		const first = await ctx.lifecycle.sendNow(rec.contact, 'gate_unlock');
		expect(first).toBe(false);
		// Tick retries.
		ctx.setNow(1);
		await ctx.lifecycle.tick();
		const templates = crm.sent.map((s) => s.template);
		expect(templates).toContain('gate_unlock');
	});

	it('tick does NOT re-send gate_unlock when it already succeeded', async () => {
		const crm = new FlakyCrm();
		const ctx = setup(crm);
		const rec = await ctx.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const first = await ctx.lifecycle.sendNow(rec.contact, 'gate_unlock');
		expect(first).toBe(true);
		const beforeCount = crm.sent.filter((s) => s.template === 'gate_unlock').length;
		ctx.setNow(1);
		await ctx.lifecycle.tick();
		const afterCount = crm.sent.filter((s) => s.template === 'gate_unlock').length;
		expect(afterCount).toBe(beforeCount);
	});

	it('tick does NOT retry gate_unlock once contact has advanced past gate_unlocked stage', async () => {
		const crm = new FlakyCrm();
		const ctx = setup(crm);
		const rec = await ctx.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		crm.failNext = 1;
		await ctx.lifecycle.sendNow(rec.contact, 'gate_unlock');
		// Contact advances (e.g. paid + received printed book).
		ctx.gate.advanceStage('p@example.com', 'paid_print');
		ctx.setNow(1);
		await ctx.lifecycle.tick();
		// Terminal stage skip; no retry, no new sends.
		expect(crm.sent.length).toBe(0);
	});
});
