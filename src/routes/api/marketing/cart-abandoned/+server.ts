// src/routes/api/marketing/cart-abandoned/+server.ts
//
// POST: client-side hook fired when Station 7 (checkout) is reached
// without payment within a debounce window. Registers the cart with
// AbandonedCartService so the recovery chain (T+1h / T+24h / T+72h) can
// fire.
//
// Request body: { parentEmail, kidId, shortcode, bookCostCents }
//   (shortcode is the canonical id — see Stories link convention)
// Response 200: { ok: true, abandonedAt }
// Response 400: missing field / invalid body
// Response 429: rate-limited
//
// Auth: relies on per-IP rate limit; no session cookie required since
// the parent has not yet completed gating. The risk surface is bounded
// by the limiter (10/IP/hour) + the requirement that shortcode+kidId match
// a real workshop draft (caller verifies upstream).

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../_shared';
import { gateRateLimit } from '$lib/services/marketing/rateLimit';

interface Body {
	parentEmail?: string;
	kidId?: string;
	shortcode?: string;
	bookCostCents?: number;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
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
			{ status: 429 },
		);
	}

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.parentEmail || typeof body.parentEmail !== 'string') {
		return json({ error: 'missing_parentEmail' }, { status: 400 });
	}
	if (!body.kidId || typeof body.kidId !== 'string') {
		return json({ error: 'missing_kidId' }, { status: 400 });
	}
	if (!body.shortcode || typeof body.shortcode !== 'string') {
		return json({ error: 'missing_shortcode' }, { status: 400 });
	}
	if (typeof body.bookCostCents !== 'number' || body.bookCostCents < 0) {
		return json({ error: 'invalid_bookCostCents' }, { status: 400 });
	}

	const deps = getMarketingDeps();
	const cart = deps.abandonedCart.track({
		parentEmail: body.parentEmail,
		kidId: body.kidId,
		shortcode: body.shortcode,
		bookCostCents: body.bookCostCents,
	});
	return json({ ok: true, abandonedAt: cart.abandonedAt });
};

/** POST cart-resolved is the success-path counterpart (payment webhook calls it). */
export const DELETE: RequestHandler = async ({ request, url }) => {
	let parentEmail = url.searchParams.get('parentEmail');
	let kidId = url.searchParams.get('kidId');
	if (!parentEmail || !kidId) {
		try {
			const body = (await request.json()) as { parentEmail?: string; kidId?: string };
			parentEmail = parentEmail ?? body.parentEmail ?? null;
			kidId = kidId ?? body.kidId ?? null;
		} catch {
			// fall through to validation below
		}
	}
	if (!parentEmail || !kidId) {
		return json({ error: 'missing_field' }, { status: 400 });
	}
	const deps = getMarketingDeps();
	const ok = deps.abandonedCart.resolve(parentEmail, kidId);
	return json({ ok });
};
