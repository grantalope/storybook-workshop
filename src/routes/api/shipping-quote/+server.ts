// src/routes/api/shipping-quote/+server.ts
//
// POST: get cached Lulu shipping quotes for an address + format + pages.
//   Body: { shippingAddress, format, pages }
//   Returns: { options: ShippingOption[] }

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	LuluFulfillmentService,
	ShippingQuoteService,
	ShippingAddressError,
	type LuluHttpClient,
	type ShippingAddress,
} from '$lib/services/fulfillment';
import type { BookFormat } from '$lib/services/assemble/types';

interface ShippingApiDeps {
	quoteService: ShippingQuoteService;
}

let _deps: ShippingApiDeps | null = null;

export function __setShippingApiDeps(deps: ShippingApiDeps): void {
	_deps = deps;
}

export function __getShippingApiDeps(): ShippingApiDeps {
	if (_deps) return _deps;
	const luluHttp = createMockLuluHttp();
	const lulu = new LuluFulfillmentService({ http: luluHttp, webhookSecret: 'test' });
	const quoteService = new ShippingQuoteService({ lulu });
	_deps = { quoteService };
	return _deps;
}

function createMockLuluHttp(): LuluHttpClient {
	return {
		async getAccessToken() {
			return { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 };
		},
		async getShippingCost(_req) {
			return {
				options: [
					{
						shippingLevel: 'MAIL',
						shipSpeed: 'mail',
						name: 'Standard mail',
						costExclTax: '4.99',
						currency: 'USD',
						etaMin: 7,
						etaMax: 14,
					},
					{
						shippingLevel: 'GROUND',
						shipSpeed: 'ground',
						name: 'Ground',
						costExclTax: '8.99',
						currency: 'USD',
						etaMin: 4,
						etaMax: 7,
					},
				],
			};
		},
		async createPrintJob(_req) {
			return { id: 'lj_mock', status: { name: 'CREATED' } };
		},
		async getPrintJob(id) {
			return { id, status: { name: 'CREATED' } };
		},
		async cancelPrintJob(_id) {},
		async reissuePrintJob(_id, _reason) {
			return { id: 'lj_reissue_mock', status: { name: 'CREATED' } };
		},
	};
}

interface Body {
	shippingAddress: ShippingAddress;
	format: BookFormat;
	pages: number;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.shippingAddress || !body.format || !body.pages) {
		return json({ error: 'missing_fields' }, { status: 400 });
	}
	try {
		const deps = __getShippingApiDeps();
		const options = await deps.quoteService.getQuote(
			body.shippingAddress,
			body.format,
			body.pages,
		);
		return json({ options });
	} catch (e) {
		if (e instanceof ShippingAddressError) {
			return json({ error: 'invalid_address', field: e.field, reason: e.reason }, { status: 400 });
		}
		return json({ error: 'quote_failed', message: (e as Error).message }, { status: 502 });
	}
};
