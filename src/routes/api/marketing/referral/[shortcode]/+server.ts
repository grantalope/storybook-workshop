// src/routes/api/marketing/referral/[shortcode]/+server.ts
//
// GET: tracks a click on the share-link surface, then 302s the visitor
// to `/dashboard/storybook-workshop?ref={shortcode}` with attribution
// set in a session cookie.
//
// This is the public click-tracking surface. Unknown shortcodes 404.
// Cookies: `swReferral=<shortcode>; Max-Age=30d; SameSite=Lax`.
//
// Response codes:
//   - 302 -> location: /?ref=<shortcode> on success
//   - 404 -> unknown shortcode

import { redirect, type RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getMarketingDeps } from '../../_shared';

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export const GET: RequestHandler = async ({ params }) => {
	const shortcode = params.shortcode as string | undefined;
	if (!shortcode || !/^[a-z2-9]{8,12}$/.test(shortcode)) {
		return json({ error: 'invalid-shortcode' }, { status: 400 });
	}
	const deps = getMarketingDeps();
	if (!deps.referral.parentForShortcode(shortcode)) {
		return json({ error: 'unknown-shortcode' }, { status: 404 });
	}
	deps.referral.recordClick(shortcode);
	// Throwing a redirect is the SvelteKit-idiomatic redirect; for testability
	// we instead return a plain Response with 302 + Location header.
	return new Response(null, {
		status: 302,
		headers: {
			location: `/?ref=${encodeURIComponent(shortcode)}`,
			'set-cookie': `swReferral=${shortcode}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`,
		},
	});
};

// Avoid unused-import lint
void redirect;
