// src/routes/api/marketing/abandoned-cart-tick/+server.ts
//
// POST: cron-triggered. Advances the abandoned-cart recovery chain one
// step (5% / 10% / 15% escalating promos at T+1h / T+24h / T+72h).
//
// Same Authorization-Bearer pattern as lifecycle-tick — fail-CLOSED in
// production when CRON_SECRET is missing, fail-open in dev/test.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';

function isProduction(env: Record<string, string | undefined>): boolean {
	const isVitest = Boolean(env.VITEST || env.VITEST_WORKER_ID);
	return env.NODE_ENV === 'production' && !isVitest;
}

function checkCron(authHeader: string | null): { ok: boolean; reason?: string } {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	const secret = env.CRON_SECRET;
	if (!secret) {
		if (isProduction(env)) return { ok: false, reason: 'cron_secret_unconfigured' };
		return { ok: true };
	}
	if (!authHeader) return { ok: false, reason: 'missing_authorization' };
	const expected = `Bearer ${secret}`;
	if (authHeader.length !== expected.length) return { ok: false, reason: 'bad_authorization' };
	let diff = 0;
	for (let i = 0; i < authHeader.length; i++) diff |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
	return diff === 0 ? { ok: true } : { ok: false, reason: 'bad_authorization' };
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	const check = checkCron(auth);
	if (!check.ok) {
		return json({ error: 'unauthorized', reason: check.reason }, { status: 401 });
	}
	const deps = getMarketingDeps();
	const report = await deps.abandonedCart.tick();
	return json({ ok: true, report });
};
