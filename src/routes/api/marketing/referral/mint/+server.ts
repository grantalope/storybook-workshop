// src/routes/api/marketing/referral/mint/+server.ts
//
// POST: mint a referral shortcode for the originating parent.
//
// Called by the read-along /r/[shortcode] page when the parent clicks
// the share button, and (optionally) by the email-gate POST endpoint
// after first-touch. Idempotent at the call-site level — callers may
// re-mint and use whichever shortcode they prefer; conversions attribute
// against ANY minted code (the share URL is the binding signal).
//
// Request: { originatingParentEmail }
// Response 200: { ok: true, shortcode, shareUrl }
// Response 400: missing email / invalid email
// Response 429: rate-limited

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../../_shared';
import { referralRateLimit } from '$lib/services/marketing/rateLimit';

interface Body {
	originatingParentEmail?: string;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = (() => {
		try {
			return getClientAddress?.() ?? 'unknown';
		} catch {
			return 'unknown';
		}
	})();
	const rl = referralRateLimit.allow(ip);
	if (!rl.ok) {
		return json(
			{ error: 'rate_limited', retryAfterMs: rl.retryAfterMs },
			{ status: 429 },
		);
	}

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.originatingParentEmail || typeof body.originatingParentEmail !== 'string') {
		return json({ error: 'missing_originatingParentEmail' }, { status: 400 });
	}
	const deps = getMarketingDeps();
	let shortcode: string;
	try {
		shortcode = deps.referral.mintShortcode(body.originatingParentEmail);
	} catch (e) {
		return json({ error: 'invalid_email', detail: (e as Error).message }, { status: 400 });
	}
	return json({ ok: true, shortcode, shareUrl: deps.referral.shareUrl(shortcode) });
};
