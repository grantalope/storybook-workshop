// src/routes/api/marketing/promo/[code]/+server.ts
//
// POST: validate-and-apply a promo code at checkout. The fulfillment
// /api/order POST cross-calls PromoCodeService.apply() server-side to
// determine the discount. This HTTP surface is for the on-checkout
// promo-code field; it is GATED by:
//
//  1. Two-tier per-IP rate-limit (bounds online brute-force enumeration
//     of per-parent codes):
//       - Cookie-PRESENT requests (caller proved knowledge of a gated email):
//         30/IP/hour via promoRateLimit.
//       - Cookie-ABSENT requests (anonymous code enumeration probe):
//         10/IP/hour via anonymousPromoRateLimit.
//     The anonymous limiter is consulted FIRST so anonymous traffic does
//     not exhaust the cookie-bearing pool; the cookie-bearing limiter is
//     also consulted to bound a compromised gated-session as well.
//  2. parentEmail must match the email bound to the swEmailGate_<shortcode>
//     cookie when the request carries one.
//
// Anonymous request flow is unchanged — the cross-call from /api/order
// stays server-internal and does not hit this surface.
//
// Request body: { parentEmail: string, subtotalCents: number, orderId?: string, shortcode?: string }
// Response 200: { ok: true, discountCents, finalCents, code: { code, type, pctOff } }
// Response 400: validation error
// Response 401: parentEmail does not match gate-cookie binding
// Response 429: rate-limited

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../../_shared';
import { anonymousPromoRateLimit, promoRateLimit } from '$lib/services/marketing/rateLimit';

interface Body {
	parentEmail?: string;
	subtotalCents?: number;
	orderId?: string;
	shortcode?: string;
}

function ipOf(getClientAddress?: () => string): string {
	try {
		return getClientAddress?.() ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Read swEmailGate_<shortcode> cookie value from the Cookie header. */
function readGateCookie(cookieHeader: string | null, shortcode: string): string | null {
	if (!cookieHeader || !shortcode) return null;
	const name = `swEmailGate_${shortcode}`;
	for (const part of cookieHeader.split(/;\s*/)) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq) === name) return part.slice(eq + 1);
	}
	return null;
}

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const code = params.code as string | undefined;
	if (!code) return json({ error: 'missing_code' }, { status: 400 });

	// Probe the cookie first (cheap header scan) so we know which limiter
	// to consult. Body is still parsed below for the actual validation.
	const cookieHeader = request.headers.get('cookie');
	const ip = ipOf(getClientAddress);

	// Tier 1: anonymous probe limiter. Bounds pure enumeration.
	// We don't yet know the shortcode (it's in the body), but the cookie
	// name is shortcode-scoped — if NO swEmailGate_* cookie is present at
	// all, the caller is fully anonymous and gets the tight limit.
	const hasAnyGateCookie = cookieHeader != null && /(?:^|;\s*)swEmailGate_/.test(cookieHeader);
	if (!hasAnyGateCookie) {
		const rlAnon = anonymousPromoRateLimit.allow(ip);
		if (!rlAnon.ok) {
			return json(
				{ error: 'rate_limited', retryAfterMs: rlAnon.retryAfterMs },
				{ status: 429 },
			);
		}
	}

	// Tier 2: cookie-bearing limiter. Bounds a compromised gated session.
	const rl = promoRateLimit.allow(ip);
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
	if (typeof body.subtotalCents !== 'number' || body.subtotalCents < 0) {
		return json({ error: 'invalid_subtotal' }, { status: 400 });
	}

	// Optional binding check: if the request carries a gate cookie for the
	// shortcode it references, verify the parentEmail matches.
	if (body.shortcode) {
		const cookie = readGateCookie(cookieHeader, body.shortcode);
		if (cookie) {
			const deps0 = getMarketingDeps();
			const matches = await deps0.gate.verifyCookie(body.parentEmail, body.shortcode, cookie);
			if (!matches) {
				return json({ error: 'cookie_email_mismatch' }, { status: 401 });
			}
		}
	}

	const deps = getMarketingDeps();
	const applied = deps.promo.apply({
		code,
		parentEmail: body.parentEmail,
		subtotalCents: body.subtotalCents,
		orderId: body.orderId,
	});
	if (!applied.ok) {
		return json({ ok: false, error: applied.error }, { status: 400 });
	}
	const promo = deps.promo.getCode(code.toUpperCase());
	return json({
		ok: true,
		discountCents: applied.discountCents,
		finalCents: applied.finalCents,
		code: promo
			? { code: promo.code, type: promo.type, pctOff: promo.pctOff }
			: undefined,
	});
};
