// src/routes/api/bundle/+server.ts
//
// POST: one-time prepaid bundle purchase. Body matches CreateBundleOpts.

import { json, type RequestHandler } from '@sveltejs/kit';
import type { BundleLength, Cadence, Format } from '$lib/services/subscription';

interface PostBody {
	recipientParentEmail: string;
	cadence: Cadence;
	format: Format;
	bookCount: BundleLength;
	giverEmail?: string;
	startAt?: number;
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
	if (![3, 6, 12, 24].includes(body.bookCount)) {
		return json({ error: 'invalid_bookCount' }, { status: 400 });
	}
	const sub = await import('$lib/services/subscription');
	const { BundleService } = sub;
	const mockPayment = {
		async createSubscription() {
			throw new Error('not used');
		},
		async cancelSubscription() {},
		async createOneTimeCharge(opts: { amountCents: number; customerEmail: string }) {
			return {
				stripePaymentIntentId: `pi_mock_${Date.now()}_${opts.amountCents}_${opts.customerEmail.split('@')[0]}`,
			};
		},
		async createGiftCheckoutSession() {
			throw new Error('not used');
		},
	};
	const svc = new BundleService({ payment: mockPayment });
	try {
		const result = await svc.create({
			recipientParentEmail: body.recipientParentEmail,
			cadence: body.cadence,
			format: body.format,
			bookCount: body.bookCount,
			giverEmail: body.giverEmail,
			startAt: body.startAt,
		});
		return json({ bundle: result }, { status: 201 });
	} catch (err) {
		return json(
			{ error: 'invalid_input', message: err instanceof Error ? err.message : String(err) },
			{ status: 400 }
		);
	}
};
