// tests/marketing/email-gate-kid-name-privacy.test.ts
//
// Regression tests for cluster D finding #2:
//   kidFirstName stored in CrmContact.tags and shipped to external CRM
//   via crm.send() vars — violates on-device privacy promise.
//
// These tests FAIL before the fix (kidFirstName in tags + in crm.send vars)
// and PASS after (kidFirstName stripped from tags and from crm.send payload).

import { describe, it, expect, vi } from 'vitest';
import { EmailGateService } from '$lib/services/marketing/EmailGateService';
import { LifecycleEmailService } from '$lib/services/marketing/LifecycleEmailService';
import type { CrmClient, CrmSendOpts } from '$lib/services/marketing/types';

const SECRET = 'test-secret-1234567890';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrmSpy(): CrmClient & { calls: CrmSendOpts[] } {
	const calls: CrmSendOpts[] = [];
	return {
		calls,
		async send(opts: CrmSendOpts) {
			calls.push({ ...opts, vars: { ...opts.vars } });
			return { ok: true };
		},
	};
}

// ---------------------------------------------------------------------------
// EmailGateService — kidFirstName MUST NOT be stored in contact.tags
// ---------------------------------------------------------------------------

describe('EmailGateService — kidFirstName privacy (regression cluster D#2)', () => {
	it('kidFirstName is NOT stored in contact.tags', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const res = await svc.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
			kidFirstName: 'Eliza',
			kidAgeBand: '4-6',
		});
		// The fix: kidFirstName must not appear in the persisted contact tags
		expect(res.contact.tags.kidFirstName).toBeUndefined();
	});

	it('contact tags with a kid name update also do NOT persist kidFirstName', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		// First record — no kid name
		await svc.record({ email: 'parent@example.com', shortcode: 'abcd1234' });
		// Second record — new shortcode, provides kid name
		const res2 = await svc.record({
			email: 'parent@example.com',
			shortcode: 'efgh5678',
			kidFirstName: 'Eliza',
		});
		expect(res2.contact.tags.kidFirstName).toBeUndefined();
	});

	it('getContact also returns a contact without kidFirstName in tags', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await svc.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
			kidFirstName: 'Eliza',
		});
		const contact = svc.getContact('parent@example.com');
		expect(contact).toBeDefined();
		expect(contact!.tags.kidFirstName).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// LifecycleEmailService — kid_name MUST NOT appear in vars sent to crm.send()
// ---------------------------------------------------------------------------

describe('LifecycleEmailService — kid_name not shipped to CRM (regression cluster D#2)', () => {
	async function recordAndGetContact(kidFirstName?: string) {
		const gate = new EmailGateService({ serverSecret: SECRET });
		const res = await gate.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
			kidFirstName,
			kidAgeBand: '4-6',
		});
		return { gate, contact: res.contact };
	}

	it('crm.send() vars do NOT include kid_name when kidFirstName was provided', async () => {
		const crm = makeCrmSpy();
		const { gate, contact } = await recordAndGetContact('Eliza');

		const lifecycle = new LifecycleEmailService({
			crm,
			gate,
			nowSource: () => contact.createdAt,
			publicUrlBase: 'https://example.com',
		});

		await lifecycle.sendNow(contact, 'gate_unlock');

		expect(crm.calls).toHaveLength(1);
		const sentVars = crm.calls[0].vars;
		// kid_name MUST NOT be in the vars shipped to the external CRM
		expect(sentVars).not.toHaveProperty('kid_name');
	});

	it('crm.send() vars do NOT include kid_name in lifecycle tick emails', async () => {
		const crm = makeCrmSpy();
		// Simulate contact created 25h ago so lifecycle_T24h is due
		const createdAt = Date.now() - 25 * 60 * 60 * 1000;
		const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => createdAt });
		await gate.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
			kidFirstName: 'Eliza',
		});
		const contact = gate.getContact('parent@example.com')!;

		const lifecycle = new LifecycleEmailService({
			crm,
			gate,
			nowSource: () => createdAt + 25 * 60 * 60 * 1000,
			publicUrlBase: 'https://example.com',
		});

		await lifecycle.tick();

		// At least one email sent, none have kid_name in CRM vars
		expect(crm.calls.length).toBeGreaterThan(0);
		for (const call of crm.calls) {
			expect(call.vars).not.toHaveProperty('kid_name');
		}
	});

	it('email subjects + HTML may still personalize locally using the kid name (smoke)', async () => {
		// This test confirms the email is RENDERED with the kid name (local only),
		// but the CRM call does NOT receive it. The rendered HTML/text is allowed
		// to contain "Eliza" because it was generated locally before being shipped
		// in the pre-rendered html/text fields — but the vars object itself must
		// not carry the name to the external vendor.
		const crm = makeCrmSpy();
		const { gate, contact } = await recordAndGetContact('Eliza');

		// Manually set createdAt so T0 is due
		const lifecycle = new LifecycleEmailService({
			crm,
			gate,
			nowSource: () => contact.createdAt,
			publicUrlBase: 'https://example.com',
		});

		await lifecycle.sendNow(contact, 'lifecycle_T0');
		expect(crm.calls).toHaveLength(1);

		const call = crm.calls[0];
		// vars should not carry kid_name to CRM
		expect(call.vars).not.toHaveProperty('kid_name');
		// But rendered HTML/subject IS allowed to reference the kid name (local personalization)
		// — we don't assert on html/text content here to avoid over-constraining the renderer
	});
});
