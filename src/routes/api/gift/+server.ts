// src/routes/api/gift/+server.ts
//
// POST: grandma's gift flow. Body matches CreateGiftOpts.
//
// In MVP, the subscription/bundle stores are stateless-per-request — the
// actual production wiring needs a persistent backend so the recipient can
// later redeem the code. Tests cover the in-memory service layer; this
// endpoint contracts the request/response shape.

import { json, type RequestHandler } from '@sveltejs/kit';
import type {
	BundleLength,
	Cadence,
	Format,
} from '$lib/services/subscription';

interface PostBody {
	recipientParentEmail: string;
	recipientName: string;
	cadence: Cadence;
	format: Format;
	bundleLength: BundleLength | null;
	startDate: number;
	cardFromGiver: string;
	giverName: string;
	giverEmail: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: PostBody;
	try {
		body = (await request.json()) as PostBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	const required: (keyof PostBody)[] = [
		'recipientParentEmail',
		'recipientName',
		'cadence',
		'format',
		'startDate',
		'cardFromGiver',
		'giverName',
		'giverEmail',
	];
	for (const k of required) {
		if (body[k] === undefined || body[k] === null) {
			return json({ error: `missing_${k}` }, { status: 400 });
		}
	}
	if (body.bundleLength !== null && ![3, 6, 12, 24].includes(body.bundleLength)) {
		return json({ error: 'invalid_bundleLength' }, { status: 400 });
	}

	const subBarrel = await import('$lib/services/subscription');
	const { GiftFlowService, SubscriptionService, BundleService } = subBarrel;

	// Stateless mocks for MVP — real impl would use singletons against the store
	const mockPayment = {
		async createSubscription() {
			return { stripeSubscriptionId: `sub_mock_${Date.now()}` };
		},
		async cancelSubscription() {},
		async createOneTimeCharge() {
			return { stripePaymentIntentId: `pi_mock_${Date.now()}` };
		},
		async createGiftCheckoutSession(opts: { giverEmail: string }) {
			return {
				stripeCheckoutId: `cs_mock_${Date.now()}_${opts.giverEmail.split('@')[0]}`,
			};
		},
	};
	const mockMailer = {
		async send() {
			return { messageId: `msg_mock_${Date.now()}` };
		},
	};

	const subs = new SubscriptionService({ payment: mockPayment });
	const bundles = new BundleService({ payment: mockPayment });
	const svc = new GiftFlowService({
		payment: mockPayment,
		mailer: mockMailer,
		subscriptions: subs,
		bundles,
	});
	try {
		const result = await svc.createGift({
			recipientParentEmail: body.recipientParentEmail,
			recipientName: body.recipientName,
			cadence: body.cadence,
			format: body.format,
			bundleLength: body.bundleLength,
			startDate: body.startDate,
			cardFromGiver: body.cardFromGiver,
			giverName: body.giverName,
			giverEmail: body.giverEmail,
		});
		return json({ gift: result }, { status: 201 });
	} catch (err) {
		return json(
			{ error: 'invalid_input', message: err instanceof Error ? err.message : String(err) },
			{ status: 400 }
		);
	}
};
