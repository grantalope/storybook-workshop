// tests/marketing/email-gate-legacy-cookie.test.ts
//
// Regression test for blocker #3: legacy (un-prefixed) cookies must NOT
// be accepted indefinitely. Pre-fix verifyCookie accepted them forever
// with no time bound; post-fix the default is REJECT, and an explicit
// opts.legacyCookieAcceptUntilMs hard deadline gates acceptance during
// the HMAC-secret rotation grace window.

import { describe, expect, it } from 'vitest';
import { EmailGateService } from '$lib/services/marketing/EmailGateService';

const SECRET = 'test-secret-1234567890';

describe('legacy cookie acceptance is time-bound', () => {
	async function mintLegacyHex(svc: EmailGateService, email: string, shortcode: string): Promise<string> {
		// The "v1:" prefix is the only difference between the v1 format and the
		// legacy 32-hex format. Strip the prefix to get a legacy cookie value.
		const rec = await svc.record({ email, shortcode });
		const v1 = rec.cookieValue;
		expect(v1.startsWith('v1:')).toBe(true);
		return v1.slice(3);
	}

	it('REJECTS legacy cookies by default (launch deployment, no opt set)', async () => {
		const svc = new EmailGateService({ serverSecret: SECRET });
		const legacy = await mintLegacyHex(svc, 'p@example.com', 'abcd1234');
		await expect(svc.verifyCookie('p@example.com', 'abcd1234', legacy)).resolves.toBe(false);
	});

	it('ACCEPTS legacy cookies while now < legacyCookieAcceptUntilMs', async () => {
		let now = 1_000_000;
		const svc = new EmailGateService({
			serverSecret: SECRET,
			nowSource: () => now,
			legacyCookieAcceptUntilMs: 1_000_000 + 60_000,
		});
		const legacy = await mintLegacyHex(svc, 'p@example.com', 'abcd1234');
		// Still inside the grace window.
		await expect(svc.verifyCookie('p@example.com', 'abcd1234', legacy)).resolves.toBe(true);
	});

	it('REJECTS legacy cookies after legacyCookieAcceptUntilMs', async () => {
		let now = 1_000_000;
		const svc = new EmailGateService({
			serverSecret: SECRET,
			nowSource: () => now,
			legacyCookieAcceptUntilMs: 1_000_000 + 60_000,
		});
		const legacy = await mintLegacyHex(svc, 'p@example.com', 'abcd1234');
		// Advance past the grace window.
		now = 1_000_000 + 60_001;
		await expect(svc.verifyCookie('p@example.com', 'abcd1234', legacy)).resolves.toBe(false);
	});

	it('always ACCEPTS v1:-prefixed cookies regardless of deadline', async () => {
		let now = 1_000_000;
		const svc = new EmailGateService({
			serverSecret: SECRET,
			nowSource: () => now,
			legacyCookieAcceptUntilMs: 1_000_000 + 60_000,
		});
		const rec = await svc.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		now = 1_000_000 + 1_000_000_000; // far past deadline
		await expect(svc.verifyCookie('p@example.com', 'abcd1234', rec.cookieValue)).resolves.toBe(true);
	});
});
