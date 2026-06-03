// src/routes/api/marketing/lifecycle-tick/+server.ts
//
// POST: cron-triggered. Advances the lifecycle scheduler one step.
// Caller is the platform's cron job (Vercel cron / GitHub Actions cron /
// Lulu sandbox cron). Safe to call at any cadence — internal idempotency
// prevents double-sends.
//
// Request: empty body (or { dryRun?: true } for diagnostic mode).
// Response 200: { report: TickReport }
//
// Authentication: must include `Authorization: Bearer <CRON_SECRET>` (env)
// when CRON_SECRET is set. Test mode (no env) skips auth.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';

function checkCron(authHeader: string | null): boolean {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	const secret = env.CRON_SECRET;
	if (!secret) return true; // no secret configured -> open (test/dev mode)
	if (!authHeader) return false;
	const expected = `Bearer ${secret}`;
	if (authHeader.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < authHeader.length; i++) diff |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
	return diff === 0;
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	if (!checkCron(auth)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}
	const deps = getMarketingDeps();
	const report = await deps.lifecycle.tick();
	return json({ ok: true, report });
};
