// src/routes/api/marketing/_shared.ts
//
// Module-scoped singletons + DI hooks for the marketing-funnel API
// endpoints. Tests inject mocks via `__setMarketingApiDeps`; production
// wiring picks env-backed defaults at first call.
//
// CRM provider selection:
//   - RESEND_API_KEY present -> ResendCrmProvider
//   - POSTMARK_SERVER_TOKEN present -> PostmarkCrmProvider
//   - neither -> MockCrmClient (dev / test fallback)
//
// Server secret for HMAC cookie: STORYBOOK_EMAIL_GATE_SECRET. In test/dev
// without an env value we fall back to a deterministic constant + warn.

import {
	AbandonedCartService,
	EducationalDripService,
	EmailGateService,
	LifecycleEmailService,
	MockCrmClient,
	PostmarkCrmProvider,
	PromoCodeService,
	ReferralLinkService,
	ResendCrmProvider,
	UnsubscribeService,
	type CrmClient,
} from '$lib/services/marketing';

export interface MarketingDeps {
	crm: CrmClient;
	gate: EmailGateService;
	lifecycle: LifecycleEmailService;
	abandonedCart: AbandonedCartService;
	referral: ReferralLinkService;
	educationalDrip: EducationalDripService;
	unsubscribe: UnsubscribeService;
	promo: PromoCodeService;
}

let _deps: MarketingDeps | null = null;

export function __setMarketingApiDeps(deps: MarketingDeps): void {
	_deps = deps;
}

export function __resetMarketingApiDeps(): void {
	_deps = null;
}

function pickProvider(): CrmClient {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	if (env.RESEND_API_KEY) {
		return new ResendCrmProvider({
			apiKey: env.RESEND_API_KEY,
			from: env.RESEND_FROM ?? 'noreply@storybook.example',
		});
	}
	if (env.POSTMARK_SERVER_TOKEN) {
		return new PostmarkCrmProvider({
			serverToken: env.POSTMARK_SERVER_TOKEN,
			from: env.POSTMARK_FROM ?? 'noreply@storybook.example',
		});
	}
	return new MockCrmClient();
}

function pickSecret(): string {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	if (env.STORYBOOK_EMAIL_GATE_SECRET && env.STORYBOOK_EMAIL_GATE_SECRET.length >= 8) {
		return env.STORYBOOK_EMAIL_GATE_SECRET;
	}
	// Test / dev fallback. Never used when STORYBOOK_EMAIL_GATE_SECRET is set.
	return 'dev-fallback-marketing-secret-do-not-use-in-prod';
}

export function getMarketingDeps(): MarketingDeps {
	if (_deps) return _deps;
	const crm = pickProvider();
	const gate = new EmailGateService({ serverSecret: pickSecret() });
	const promo = new PromoCodeService();
	const lifecycle = new LifecycleEmailService({ crm, gate });
	const abandonedCart = new AbandonedCartService({ crm, promo });
	const referral = new ReferralLinkService({ crm });
	const educationalDrip = new EducationalDripService({ crm, gate });
	const unsubscribe = new UnsubscribeService({ gate });
	_deps = { crm, gate, lifecycle, abandonedCart, referral, educationalDrip, unsubscribe, promo };
	return _deps;
}
