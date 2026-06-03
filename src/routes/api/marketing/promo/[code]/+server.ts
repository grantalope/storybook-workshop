// src/routes/api/marketing/promo/[code]/+server.ts
//
// POST: validate-and-apply a promo code at checkout. The fulfillment
// /api/order POST cross-calls this via PromoCodeService.apply() to
// determine the discount. This HTTP surface is also reachable from the
// UI for the on-checkout promo-code field.
//
// Request body: { parentEmail: string, subtotalCents: number, orderId?: string }
// Response 200:
//   { ok: true, discountCents, finalCents, code: { code, type, pctOff } }
// Response 400:
//   { ok: false, error: 'unknown' | 'expired' | 'exhausted' | 'wrong_parent' | 'already_used_in_order' }

import { json, type RequestHandler } from '@sveltejs/kit';
import { getMarketingDeps } from '../../_shared';

export const POST: RequestHandler = async ({ params, request }) => {
	const code = params.code as string | undefined;
	if (!code) return json({ error: 'missing_code' }, { status: 400 });
	let body: { parentEmail?: string; subtotalCents?: number; orderId?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.parentEmail || typeof body.parentEmail !== 'string') {
		return json({ error: 'missing_parentEmail' }, { status: 400 });
	}
	if (typeof body.subtotalCents !== 'number' || body.subtotalCents < 0) {
		return json({ error: 'invalid_subtotal' }, { status: 400 });
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
