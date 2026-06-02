// src/routes/api/birthday-cron/+server.ts
//
// POST: triggered by external cron (system cron or cloud scheduler) once
// per day. Internal-only — gated by a shared `BIRTHDAY_CRON_TOKEN` header.
//
// In MVP, runs a no-op tick against an empty profile store (production
// wiring will hydrate the registry from the persistent kid-profile store).

import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	// Internal-only — require auth header
	const auth = request.headers.get('x-birthday-cron-token');
	const expected = (globalThis as { BIRTHDAY_CRON_TOKEN?: string }).BIRTHDAY_CRON_TOKEN;
	// In dev / test, the header check is permissive when the env token is unset;
	// in prod we expect both sides set and matching.
	if (expected && auth !== expected) {
		return json({ error: 'forbidden' }, { status: 403 });
	}
	const subBarrel = await import('$lib/services/subscription');
	const { BirthdayCronService } = subBarrel;
	const mockMailer = {
		async send() {
			return { messageId: `msg_${Date.now()}` };
		},
	};
	const svc = new BirthdayCronService({ mailer: mockMailer });
	// MVP: no profile hydration — production wiring loads from the kid
	// profile store before tick().
	const result = await svc.tick();
	return json({ result }, { status: 200 });
};
