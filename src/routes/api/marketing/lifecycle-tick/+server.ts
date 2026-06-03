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
// Authentication: must include `Authorization: Bearer <CRON_SECRET>` (env).
// In production we fail-CLOSED if CRON_SECRET is missing — a silent
// misconfig must NOT leave this open to anonymous flood-send. In
// vitest / dev (NODE_ENV !== 'production' OR VITEST set) the check
// short-circuits to "open" so tests can run without env plumbing.

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
		// Production: fail CLOSED. Dev/test: allow (ergonomic — tests should not
		// have to plumb env vars to exercise the tick).
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
	const report = await deps.lifecycle.tick();
	return json({ ok: true, report });
};
