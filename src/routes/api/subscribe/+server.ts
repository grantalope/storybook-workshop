// src/routes/api/subscribe/+server.ts
//
// POST: create a recurring subscription. Body shape matches
// CreateSubscriptionOpts minus internal fields. Mock PaymentProvider is
// constructed per-request for MVP — production wiring will replace this
// with the real Stripe adapter from the fulfillment goal.
//
// Spec §6.4 + goal Build sequence phase 9.

import { json, type RequestHandler } from '@sveltejs/kit';
import type { Cadence, Format, BillingMode } from '$lib/services/subscription';

interface PostBody {
	recipientParentEmail: string;
	kidId?: string;
	cadence: Cadence;
	format: Format;
	billingMode: BillingMode;
	autopilotEnabled?: boolean;
	seriesThemeId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.recipientParentEmail) {
		return json({ error: 'missing_recipientParentEmail' }, { status: 400 });
	}
	if (!body.cadence || !body.format || !body.billingMode) {
		return json({ error: 'missing_cadence_format_billingMode' }, { status: 400 });
	}

	// Lazy import to avoid pulling the service graph into the cold path
	const sub = await import('$lib/services/subscription');
	const { SubscriptionService } = sub;
	// MVP: stateless per-request mock provider. Real impl will use a
	// singleton wired in a server bootstrap.
	const mockPayment = {
		async createSubscription(opts: { customerEmail: string }) {
			return {
				stripeSubscriptionId: `sub_mock_${Date.now()}_${opts.customerEmail.split('@')[0]}`,
			};
		},
		async cancelSubscription() {},
		async createOneTimeCharge() {
			throw new Error('not used in this endpoint');
		},
		async createGiftCheckoutSession() {
			throw new Error('not used in this endpoint');
		},
	};
	const svc = new SubscriptionService({ payment: mockPayment });
	try {
		const result = await svc.create({
			recipientParentEmail: body.recipientParentEmail,
			kidId: body.kidId,
			cadence: body.cadence,
			format: body.format,
			billingMode: body.billingMode,
			autopilotEnabled: body.autopilotEnabled,
			seriesThemeId: body.seriesThemeId,
		});
		return json({ subscription: result }, { status: 201 });
	} catch (err) {
		return json(
			{ error: 'invalid_input', message: err instanceof Error ? err.message : String(err) },
			{ status: 400 }
		);
	}
};
