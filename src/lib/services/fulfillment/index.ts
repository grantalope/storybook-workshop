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
export type { LifecycleHandlers } from './OrderLifecycleService';
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
	PostmarkEmailProvider,
} from './TransactionalEmailProvider';
export {
	ResendEmailProvider,
	ResendSendError,
	RESEND_API_URL,
	subjectFor as resendSubjectFor,
	textBodyFor as resendTextBodyFor,
	htmlBodyFor as resendHtmlBodyFor,
	buildUnsubscribeUrl as resendUnsubscribeUrl,
	buildEmailHandlersFromProvider,
} from './resend-provider';
export type {
	ResendEmailProviderOpts,
	ResendAuditEntry,
	ResendAuditSink,
	ResendSendErrorMeta,
} from './resend-provider';
