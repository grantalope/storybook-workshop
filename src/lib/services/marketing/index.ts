// @graph-layer: private
// @rationale: private (marketing subsystem barrel)
//
// src/lib/services/marketing/index.ts
//
// Public barrel for the marketing-funnel subsystem (goal #11).
// Cross-deps:
//   - book-assembler (read /api/book/[shortcode] for gate UI),
//   - fulfillment (PromoCodeService.validate at /api/order POST),
//   - subscription (BirthdayCronService can mint birthday promos via
//     PromoCodeService.mintBirthdayPromo).

export * from './types';
export {
	EmailGateService,
} from './EmailGateService';
export {
	LifecycleEmailService,
	LIFECYCLE_SCHEDULE,
} from './LifecycleEmailService';
export type { TickReport } from './LifecycleEmailService';
export {
	AbandonedCartService,
	ABANDONED_CART_SCHEDULE,
} from './AbandonedCartService';
export type { CartTickReport } from './AbandonedCartService';
export {
	ReferralLinkService,
	REFERRAL_CREDIT_CENTS,
} from './ReferralLinkService';
export {
	EducationalDripService,
	EDU_DRIP_CATALOG,
} from './EducationalDripService';
export type { DripTickReport } from './EducationalDripService';
export {
	UnsubscribeService,
} from './UnsubscribeService';
export type { UnsubscribeResult } from './UnsubscribeService';
export {
	PromoCodeService,
	FIRST_TIME_CODE,
} from './PromoCodeService';
export {
	MockCrmClient,
	ResendCrmProvider,
	PostmarkCrmProvider,
	subjectFor,
	textFor,
	footerFor,
} from './CrmClient';
export type {
	ResendCrmProviderOpts,
	PostmarkCrmProviderOpts,
} from './CrmClient';
export {
	renderEmail,
} from './EmailRenderer';
export type { RenderedEmail, RenderEmailOpts } from './EmailRenderer';
export { mintUnsubToken, verifyUnsubToken } from "./unsubToken";
