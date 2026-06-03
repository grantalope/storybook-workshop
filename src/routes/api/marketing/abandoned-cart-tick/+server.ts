// src/routes/api/marketing/abandoned-cart-tick/+server.ts
//
// POST: cron-triggered. Advances the abandoned-cart recovery chain one
// step (5% / 10% / 15% escalating promos at T+1h / T+24h / T+72h).
//
// Same Authorization-Bearer pattern as lifecycle-tick.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';

function checkCron(authHeader: string | null): boolean {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	const secret = env.CRON_SECRET;
	if (!secret) return true;
	if (!authHeader) return false;
	const expected = `Bearer ${secret}`;
	if (authHeader.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < authHeader.length; i++) diff |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
	return diff === 0;
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	if (!checkCron(auth)) return json({ error: 'unauthorized' }, { status: 401 });
	const deps = getMarketingDeps();
	const report = await deps.abandonedCart.tick();
	return json({ ok: true, report });
};
