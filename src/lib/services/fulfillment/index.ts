// @graph-layer: private
// @rationale: private (fulfillment barrel)
//
// src/lib/services/fulfillment/index.ts
//
// Public barrel for the fulfillment subsystem.

export * from './types';
export {
	LuluFulfillmentService,
	createFetchLuluHttpClient,
	createLuluService,
} from './LuluFulfillmentService';
export {
	StripeCheckoutService,
	createFetchStripeHttpClient,
	createStripeService,
} from './StripeCheckoutService';
export {
	OrderLifecycleService,
	OrderLifecycleError,
	InMemoryOrderStore,
} from './OrderLifecycleService';
export {
	ShippingQuoteService,
	ShippingAddressError,
	validateShippingAddress,
	SHIPPING_QUOTE_TTL_MS,
} from './ShippingQuoteService';
export { OrderAuditService } from './OrderAuditService';
export {
	QualityGuaranteeHandler,
	InMemoryQualityClaimStore,
	CLAIM_WINDOW_MS,
} from './QualityGuaranteeHandler';
export { ReprintCoordinator } from './ReprintCoordinator';
export {
	NoopEmailProvider,
	LoggingEmailProvider,
	ResendEmailProvider,
	PostmarkEmailProvider,
} from './TransactionalEmailProvider';
