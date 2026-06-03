import { describe, expect, it } from 'vitest';
import { EmailGateService } from '$lib/services/marketing/EmailGateService';

const SECRET = 'test-secret-1234567890';

describe('EmailGateService', () => {
	it('records a fresh email + mints a cookie', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const res = await svc.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
			kidAgeBand: '4-6',
			themePicked: 'forest',
			lengthTier: 'bedtime',
		});
		expect(res.reused).toBe(false);
		expect(res.cookieValue).toHaveLength(32);
		expect(res.contact.email).toBe('parent@example.com');
		expect(res.contact.lifecycleStage).toBe('gate_unlocked');
		expect(res.contact.tags.kidAgeBand).toBe('4-6');
		expect(res.contact.tags.themePicked).toBe('forest');
		expect(res.contact.tags.lengthTier).toBe('bedtime');
	});

	it('is idempotent on re-submitting the same (email, shortcode)', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const a = await svc.record({ email: 'parent@example.com', shortcode: 'abcd1234' });
		const b = await svc.record({ email: 'parent@example.com', shortcode: 'abcd1234' });
		expect(b.reused).toBe(true);
		expect(b.cookieValue).toBe(a.cookieValue);
		expect(b.contact.createdAt).toBe(a.contact.createdAt);
	});

	it('mints a different cookie for a different shortcode (same email)', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const a = await svc.record({ email: 'parent@example.com', shortcode: 'abcd1234' });
		const b = await svc.record({ email: 'parent@example.com', shortcode: 'efgh5678' });
		expect(b.cookieValue).not.toBe(a.cookieValue);
		expect(b.contact.lastShortcode).toBe('efgh5678');
	});

	it('verifies a cookie via HMAC', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const { cookieValue } = await svc.record({
			email: 'parent@example.com',
			shortcode: 'abcd1234',
		});
		await expect(svc.verifyCookie('parent@example.com', 'abcd1234', cookieValue)).resolves.toBe(
			true,
		);
		await expect(svc.verifyCookie('other@example.com', 'abcd1234', cookieValue)).resolves.toBe(
			false,
		);
		await expect(svc.verifyCookie('parent@example.com', 'wrong', cookieValue)).resolves.toBe(
			false,
		);
		await expect(svc.verifyCookie('parent@example.com', 'abcd1234', 'tampered00000000000000000000000')).resolves.toBe(
			false,
		);
	});

	it('rejects an invalid email', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await expect(svc.record({ email: 'not-an-email', shortcode: 'abcd1234' })).rejects.toThrow(
			/invalid email/,
		);
	});

	it('rejects a too-short shortcode', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await expect(svc.record({ email: 'p@example.com', shortcode: 'ab' })).rejects.toThrow(
			/invalid shortcode/,
		);
	});

	it('rejects a too-short server secret at construction', () => {
		expect(() => new EmailGateService({ serverSecret: 'short' })).toThrow(/>= 8 chars/);
	});

	it('advances lifecycle stage', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await svc.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		svc.advanceStage('p@example.com', 'paid_print');
		expect(svc.getContact('p@example.com')?.lifecycleStage).toBe('paid_print');
	});

	it('cascades educational opt-out when marketing is set', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await svc.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		svc.setUnsubscribed('p@example.com', 'marketing', true);
		const c = svc.getContact('p@example.com');
		expect(c?.unsubscribed.marketing).toBe(true);
		expect(c?.unsubscribed.educational).toBe(true);
		expect(c?.unsubscribed.transactional).toBe(false);
	});

	it('deletes a contact', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await svc.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		expect(svc.deleteContact('p@example.com')).toBe(true);
		expect(svc.getContact('p@example.com')).toBeUndefined();
	});

	it('lists all contacts', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		await svc.record({ email: 'a@example.com', shortcode: 'abcd1234' });
		await svc.record({ email: 'b@example.com', shortcode: 'efgh5678' });
		expect(svc.allContacts()).toHaveLength(2);
	});
});
