// src/routes/api/marketing/referral/[shortcode]/+server.ts
//
// GET: tracks a click on the share-link surface and 302s the visitor to
// `/?ref={shortcode}` so the workshop entry can attribute the referral
// in a cookie. This is the path top-level link visitors hit (e.g.,
// grandparent clicks the share link from an email).
//
// POST: lightweight click-tracking call used from inside the read-along
// page. No redirect, no cookie. Used by the /r/<shortcode> client when
// the URL carries `?ref=...` so attribution is recorded server-side
// without forcing a navigation.
//
// Unknown shortcodes 404 in both. Invalid shortcode format (regex) 400.
// Cookies: `swReferral=<shortcode>; HttpOnly; Secure (when HTTPS); Path=/;
// SameSite=Lax; Max-Age=30d`.
//
// SHORTCODE_REGEX is deliberately tight (lowercase alphanumeric, no
// ambiguous chars) to keep the URL-injected value safe before
// encodeURIComponent.

import { json, redirect, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../../_shared';
import { referralRateLimit } from '$lib/services/marketing/rateLimit';

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const SHORTCODE_REGEX = /^[a-z2-9]{8,12}$/;

function ipOf(getClientAddress?: () => string): string {
	try {
		return getClientAddress?.() ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
	const shortcode = params.shortcode as string | undefined;
	if (!shortcode || !SHORTCODE_REGEX.test(shortcode)) {
		return json({ error: 'invalid-shortcode' }, { status: 400 });
	}
	const rl = referralRateLimit.allow(ipOf(getClientAddress));
	if (!rl.ok) {
		return json({ error: 'rate_limited', retryAfterMs: rl.retryAfterMs }, { status: 429 });
	}
	const deps = getMarketingDeps();
	if (!deps.referral.parentForShortcode(shortcode)) {
		return json({ error: 'unknown-shortcode' }, { status: 404 });
	}
	deps.referral.recordClick(shortcode);
	const isHttps = url.protocol === 'https:';
	const secureFlag = isHttps ? ' Secure;' : '';
	return new Response(null, {
		status: 302,
		headers: {
			location: `/?ref=${encodeURIComponent(shortcode)}`,
			'set-cookie': `swReferral=${shortcode}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`,
		},
	});
};

/** POST: track-only — no redirect, no cookie. Used inside the read-along page. */
export const POST: RequestHandler = async ({ params, getClientAddress }) => {
	const shortcode = params.shortcode as string | undefined;
	if (!shortcode || !SHORTCODE_REGEX.test(shortcode)) {
		return json({ error: 'invalid-shortcode' }, { status: 400 });
	}
	const rl = referralRateLimit.allow(ipOf(getClientAddress));
	if (!rl.ok) {
		return json({ error: 'rate_limited', retryAfterMs: rl.retryAfterMs }, { status: 429 });
	}
	const deps = getMarketingDeps();
	if (!deps.referral.parentForShortcode(shortcode)) {
		return json({ error: 'unknown-shortcode' }, { status: 404 });
	}
	deps.referral.recordClick(shortcode);
	return json({ ok: true });
};

// Avoid unused-import lint
void redirect;
