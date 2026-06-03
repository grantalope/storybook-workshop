// src/routes/api/marketing/email-gate/+server.ts
//
// POST: anonymous parent unlocks the read-along past page 4 by submitting
// their email.
//
// Request: { email, shortcode, kidFirstName?, kidAgeBand?, themePicked?,
//            lengthTier?, pillarArchetypeFamily? }
// Response 200: { ok: true, unlocked: true, reused: boolean }
// Response 400: { error: 'invalid_email' | 'invalid_shortcode' | 'invalid_json' | 'missing_field' }
// Response 429: when rate limit per-IP is exceeded
//
// Side effects:
//   1. EmailGateService.record() upserts the CRM contact.
//   2. LifecycleEmailService.sendNow(contact, 'gate_unlock') fires the
//      welcome email immediately. Errors LOG (not silently swallowed).
//   3. Set-Cookie: swEmailGate_<shortcode>=<hex>; HttpOnly; Secure (when
//      HTTPS); SameSite=Lax; Max-Age=2592000 (30 days).

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';
import { InvalidEmailError, InvalidShortcodeError } from '$lib/services/marketing/EmailGateService';
import { gateRateLimit } from '$lib/services/marketing/rateLimit';

interface EmailGateBody {
	email?: string;
	shortcode?: string;
	kidAgeBand?: string;
	themePicked?: string;
	lengthTier?: string;
	pillarArchetypeFamily?: string;
	kidFirstName?: string;
}

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

/** Stable, low-cardinality fingerprint for log lines (no PII). */
function hashEmail(email: string): string {
	const lower = (email ?? '').toLowerCase();
	let h = 5381;
	for (let i = 0; i < lower.length; i++) {
		h = ((h << 5) + h + lower.charCodeAt(i)) >>> 0;
	}
	return `e_${h.toString(16)}`;
}

export const POST: RequestHandler = async ({ request, getClientAddress, url }) => {
	// Per-IP rate limit. Bounds CRM contact-spam + welcome-email amplification.
	const ip = (() => {
		try {
			return getClientAddress?.() ?? 'unknown';
		} catch {
			return 'unknown';
		}
	})();
	const rl = gateRateLimit.allow(ip);
	if (!rl.ok) {
		return json(
			{ error: 'rate_limited', retryAfterMs: rl.retryAfterMs },
			{
				status: 429,
				headers: {
					'retry-after': String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)),
				},
			},
		);
	}

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
			kidFirstName: body.kidFirstName,
		});
	} catch (e) {
		if (e instanceof InvalidEmailError) return json({ error: 'invalid_email' }, { status: 400 });
		if (e instanceof InvalidShortcodeError) return json({ error: 'invalid_shortcode' }, { status: 400 });
		console.error('[email-gate] record failed', {
			emailHash: hashEmail(body.email),
			error: (e as Error).message,
		});
		return json({ error: 'service_unavailable' }, { status: 503 });
	}

	if (!res.reused) {
		// Fire-and-forget welcome email — non-blocking on response.
		// Errors are LOGGED rather than silently swallowed so a misconfigured
		// CRM (bad API key, quota exhausted) surfaces in ops.
		void deps.lifecycle
			.sendNow(res.contact, 'gate_unlock')
			.catch((err: unknown) =>
				console.error('[email-gate] lifecycle.sendNow failed', {
					template: 'gate_unlock',
					emailHash: hashEmail(body.email!),
					error: (err as Error).message,
				}),
			);
	}

	const cookieName = `swEmailGate_${body.shortcode}`;
	const isHttps = url.protocol === 'https:';
	const secureFlag = isHttps ? ' Secure;' : '';
	return json(
		{ ok: true, unlocked: true, reused: res.reused },
		{
			status: 200,
			headers: {
				'set-cookie': `${cookieName}=${res.cookieValue}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`,
			},
		},
	);
};
