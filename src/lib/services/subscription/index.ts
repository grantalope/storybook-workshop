// @graph-layer: private
// @rationale: private (per-user / per-recipient subscription state)
//
// src/routes/dashboard/services/storybook-workshop/subscription/index.ts
//
// Public barrel for the storybook-workshop subscription engine (Wave 2).
// Each consumer (API endpoints, workshop UI, autopilot loop) imports from
// here — never reach into individual files.

export type {
	AutopilotApproveOpts,
	AutopilotDraft,
	AutopilotDraftStatus,
	BillingMode,
	BirthdayCronTickResult,
	Bundle,
	BundleLength,
	BundlePriceCents,
	BundleStatus,
	Cadence,
	CreateBundleOpts,
	CreateGiftOpts,
	CreateSubscriptionOpts,
	Format,
	Gift,
	GiftDedicationOverride,
	GiftStatus,
	KidBirthdayProfile,
	MailerProvider,
	MailKind,
	PaymentProvider,
	PeriodicScheduler,
	PriceCents,
	ReferralClick,
	ReferralConversion,
	ReferralCredit,
	SeriesTheme,
	StoryAuthorHook,
	StripePriceRef,
	Subscription,
	SubscriptionStatus,
	ThemeId,
} from './types';

export {
	MAX_CONSECUTIVE_SKIPS,
	MS_PER_DAY,
	PRICING_CATALOG,
	STRIPE_PRICE_CATALOG,
	SubscriptionService,
	nextCadenceAt,
	priceCentsFor,
	stripePriceIdFor,
} from './SubscriptionService';

export {
	BUNDLE_PRICES,
	BundleService,
	bundleCentsFor,
	materializeSlots,
} from './BundleService';

export { GiftFlowService } from './GiftFlowService';

export {
	SERIES_THEMES,
	getSeries,
	getThemeAtSlot,
	listSeries,
	validateRegistryShape,
} from './SeriesThemeRegistry';

export {
	APPROVAL_WINDOW_DAYS,
	AutopilotDrafter,
	TICK_INTERVAL_MS,
	WEEKLY_BATCH_APPROVAL_WINDOW_DAYS,
	WEEKLY_BATCH_SIZE,
} from './AutopilotDrafter';

export {
	BIRTHDAY_FIRE_BAND_DAYS,
	BIRTHDAY_LEAD_DAYS,
	BirthdayCronService,
} from './BirthdayCronService';

export {
	REFERRAL_CREDIT_CENTS,
	ReferralAttribution,
	SHORTCODE_LENGTH,
} from './ReferralAttribution';
