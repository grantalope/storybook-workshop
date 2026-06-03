// src/routes/api/marketing/email-gate/+server.ts
//
// POST: anonymous parent unlocks the read-along past page 4 by submitting
// their email.
//
// Request: { email, shortcode, kidAgeBand?, themePicked?, lengthTier?, pillarArchetypeFamily? }
// Response 200: { ok: true, unlocked: true, reused: boolean }
// Response 400: { error: 'invalid_email' | 'invalid_shortcode' | 'invalid_json' | 'missing_field' }
//
// Side effects:
//   1. EmailGateService.record() upserts the CRM contact.
//   2. LifecycleEmailService.sendNow(contact, 'gate_unlock') fires the
//      welcome email immediately.
//   3. Set-Cookie: swEmailGate_<shortcode>=<hex>; HttpOnly; SameSite=Lax;
//      Max-Age=2592000 (30 days).
//
// No email content is stored beyond the CRM contact tags.

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';

interface EmailGateBody {
	email?: string;
	shortcode?: string;
	kidAgeBand?: string;
	themePicked?: string;
	lengthTier?: string;
	pillarArchetypeFamily?: string;
}

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export const POST: RequestHandler = async ({ request }) => {
	let body: EmailGateBody;
	try {
		body = (await request.json()) as EmailGateBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	if (!body.email || typeof body.email !== 'string') {
		return json({ error: 'missing_field', field: 'email' }, { status: 400 });
	}
	if (!body.shortcode || typeof body.shortcode !== 'string') {
		return json({ error: 'missing_field', field: 'shortcode' }, { status: 400 });
	}

	const deps = getMarketingDeps();
	let res;
	try {
		res = await deps.gate.record({
			email: body.email,
			shortcode: body.shortcode,
			kidAgeBand: body.kidAgeBand,
			themePicked: body.themePicked,
			lengthTier: body.lengthTier,
			pillarArchetypeFamily: body.pillarArchetypeFamily,
		});
	} catch (e) {
		const msg = (e as Error).message;
		if (msg.includes('email')) return json({ error: 'invalid_email' }, { status: 400 });
		if (msg.includes('shortcode')) return json({ error: 'invalid_shortcode' }, { status: 400 });
		throw e;
	}

	if (!res.reused) {
		// Fire-and-forget welcome email — non-blocking on response.
		void deps.lifecycle.sendNow(res.contact, 'gate_unlock').catch(() => undefined);
	}

	const cookieName = `swEmailGate_${body.shortcode}`;
	return json(
		{ ok: true, unlocked: true, reused: res.reused },
		{
			status: 200,
			headers: {
				'set-cookie': `${cookieName}=${res.cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`,
			},
		},
	);
};
