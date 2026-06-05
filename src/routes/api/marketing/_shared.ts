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
// Server secret for HMAC cookie / unsubscribe-token: STORYBOOK_EMAIL_GATE_SECRET.
// In production (NODE_ENV === 'production' AND not vitest), the secret MUST
// be configured — pickSecret() throws on missing env. The dev/test fallback
// is only available outside production.

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
	/** Server HMAC secret. Shared between gate-cookie + unsub-token mints. */
	serverSecret: string;
}

let _deps: MarketingDeps | null = null;

export function __setMarketingApiDeps(deps: Partial<MarketingDeps> & Omit<MarketingDeps, 'serverSecret'>): void {
	// Allow tests to omit serverSecret (defaults to a test constant) but
	// production code paths always pass through getMarketingDeps which
	// requires a real configured secret.
	_deps = {
		...(deps as MarketingDeps),
		serverSecret: deps.serverSecret ?? 'test-shared-secret-do-not-use-in-prod',
	};
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

/** True if we are running inside vitest. */
function isVitest(): boolean {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	return Boolean(env.VITEST || env.VITEST_WORKER_ID);
}

/** True if we are running in a production deploy (NOT vitest, NOT dev). */
function isProduction(): boolean {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	return env.NODE_ENV === 'production' && !isVitest();
}

function pickSecret(): string {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
	if (env.STORYBOOK_EMAIL_GATE_SECRET && env.STORYBOOK_EMAIL_GATE_SECRET.length >= 8) {
		return env.STORYBOOK_EMAIL_GATE_SECRET;
	}
	if (isProduction()) {
		// Fail-CLOSED in production: no fallback secret. Ops must configure
		// STORYBOOK_EMAIL_GATE_SECRET (>= 8 chars) before deploy.
		throw new Error(
			'STORYBOOK_EMAIL_GATE_SECRET is not configured. Production deploys require this env to be set to a >= 8 char secret. See docs/production-deploy.md.',
		);
	}
	// Dev / test fallback. Never reached in production due to the throw above.
	return 'dev-fallback-marketing-secret-do-not-use-in-prod';
}

export function getMarketingDeps(): MarketingDeps {
	if (_deps) return _deps;
	const crm = pickProvider();
	const serverSecret = pickSecret();
	const gate = new EmailGateService({ serverSecret });
	const promo = new PromoCodeService();
	const lifecycle = new LifecycleEmailService({ crm, gate, serverSecret });
	const abandonedCart = new AbandonedCartService({ crm, promo, serverSecret });
	const referral = new ReferralLinkService({ crm });
	const educationalDrip = new EducationalDripService({ crm, gate, serverSecret });
	const unsubscribe = new UnsubscribeService({ gate });
	_deps = {
		crm,
		gate,
		lifecycle,
		abandonedCart,
		referral,
		educationalDrip,
		unsubscribe,
		promo,
		serverSecret,
	};
	return _deps;
}

/** Exposed for endpoint code paths that need the secret without the full deps. */
export function getServerSecret(): string {
	return getMarketingDeps().serverSecret;
}
