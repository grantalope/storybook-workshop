// tests/fulfillment/wireFulfillmentDeps.ts

import {
	InMemoryOrderStore,
	InMemoryQualityClaimStore,
	LuluFulfillmentService,
	OrderLifecycleService,
	QualityGuaranteeHandler,
	ShippingQuoteService,
	StripeCheckoutService,
	type FulfillmentOrderStore,
	type LuluShippingCostResponse,
	type QualityClaimStore,
	type ShippingOption,
	type StripeHttpClient,
} from '$lib/services/fulfillment';
import { __setLuluWebhookApiDeps } from '../../src/routes/api/lulu-webhook/+server';
import { __setOrderApiDeps } from '../../src/routes/api/order/+server';
import { __setQualityApiDeps } from '../../src/routes/api/quality-claim/+server';
import { __setShippingApiDeps } from '../../src/routes/api/shipping-quote/+server';
import { __setStripeWebhookApiDeps } from '../../src/routes/api/stripe-webhook/+server';
import {
	createMockLulu,
	createMockStripe,
	makeClock,
	makeIdGen,
	makeShippingOption,
} from './fixtures';

export const DEFAULT_SERVER_SHIPPING_OPTIONS: ShippingOption[] = [
	makeShippingOption({
		name: 'Standard mail',
		shipSpeed: 'mail',
		costCents: 499,
		currency: 'USD',
		etaDays: 14,
		luluShippingLevel: 'MAIL',
	}),
	makeShippingOption({
		name: 'Ground',
		shipSpeed: 'ground',
		costCents: 899,
		currency: 'USD',
		etaDays: 6,
		luluShippingLevel: 'GROUND',
	}),
];

export interface WireFulfillmentDepsOptions {
	store?: FulfillmentOrderStore;
	claimStore?: QualityClaimStore;
	stripeHttp?: StripeHttpClient;
	luluHttp?: ReturnType<typeof createMockLulu>;
	shippingOptions?: ShippingOption[];
	stripeWebhookSecret?: string;
	luluWebhookSecret?: string;
	idGen?: () => string;
	claimIdGen?: () => string;
	clock?: ReturnType<typeof makeClock>;
}

export function wireFulfillmentDeps(opts: WireFulfillmentDepsOptions = {}) {
	const store = opts.store ?? new InMemoryOrderStore();
	const claimStore = opts.claimStore ?? new InMemoryQualityClaimStore();
	const clock = opts.clock ?? makeClock();
	const stripeHttp = opts.stripeHttp ?? createMockStripe();
	const luluHttp = opts.luluHttp ?? createMockLulu();

	if (!opts.luluHttp || opts.shippingOptions) {
		luluHttp.setShippingResponse({
			options: toLuluShippingOptions(opts.shippingOptions ?? DEFAULT_SERVER_SHIPPING_OPTIONS),
		});
	}

	const stripe = new StripeCheckoutService({
		http: stripeHttp,
		webhookSecret: opts.stripeWebhookSecret ?? 'whsec_test',
		nowSource: () => clock.now(),
	});
	const lulu = new LuluFulfillmentService({
		http: luluHttp,
		webhookSecret: opts.luluWebhookSecret ?? 'lulu-test-secret',
	});
	const shippingQuote = new ShippingQuoteService({
		lulu,
		nowSource: clock.now,
	});
	const lifecycle = new OrderLifecycleService({ store, nowSource: clock.now });
	const idGen = opts.idGen ?? makeIdGen('ord');
	const claimIdGen = opts.claimIdGen ?? makeIdGen('claim');
	const handler = new QualityGuaranteeHandler({
		orderStore: store,
		claimStore,
		nowSource: clock.now,
	});

	__setOrderApiDeps({
		lifecycle,
		stripe,
		store,
		qualityClaimStore: claimStore,
		shippingQuote,
		idGen,
		nowSource: clock.now,
	});
	__setStripeWebhookApiDeps({ stripe });
	__setLuluWebhookApiDeps({ lulu });
	__setShippingApiDeps({ quoteService: shippingQuote });
	__setQualityApiDeps({ handler, claimStore, idGen: claimIdGen });

	return {
		store,
		claimStore,
		stripe,
		stripeHttp,
		lulu,
		luluHttp,
		shippingQuote,
		lifecycle,
		clock,
		idGen,
		claimIdGen,
	};
}

export function toLuluShippingOptions(
	options: ShippingOption[],
): LuluShippingCostResponse['options'] {
	return options.map((option) => ({
		shippingLevel: option.luluShippingLevel,
		shipSpeed: option.shipSpeed,
		name: option.name,
		costExclTax: (option.costCents / 100).toFixed(2),
		currency: option.currency,
		etaMin: option.etaDays,
		etaMax: option.etaDays,
	}));
}
