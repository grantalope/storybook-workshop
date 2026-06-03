// src/routes/api/marketing/promo/[code]/+server.ts
//
// POST: validate-and-apply a promo code at checkout. The fulfillment
// /api/order POST cross-calls PromoCodeService.apply() server-side to
// determine the discount. This HTTP surface is for the on-checkout
// promo-code field; it is GATED by:
//
//  1. Per-IP rate-limit (30/IP/hour). Bounds online brute-force enumeration
//     of per-parent codes.
//  2. parentEmail must match the email bound to the swEmailGate_<shortcode>
//     cookie when the request carries one. Requests WITHOUT a gate cookie
//     are still allowed (the field is publicly editable) but rate-limited
//     more aggressively.
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
import { promoRateLimit } from '$lib/services/marketing/rateLimit';

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
	const rl = promoRateLimit.allow(ipOf(getClientAddress));
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
		const cookieHeader = request.headers.get('cookie');
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
