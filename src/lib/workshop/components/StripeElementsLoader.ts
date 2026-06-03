// @graph-layer: private
// @rationale: private (lazy-loaded Stripe.js bridge — billing client surface)
//
// src/lib/workshop/components/StripeElementsLoader.ts
//
// Lazy-load the official Stripe.js v3 client from https://js.stripe.com.
// Stripe REQUIRES the script load directly from their CDN (loading from a
// bundled copy is a violation of the Stripe TOS + PCI-compliance posture;
// the script self-updates for the global anti-fraud + 3DS layers and
// MUST run from the canonical URL).
//
// Usage:
//   const stripe = await loadStripe(publishableKey);
//   if (!stripe) throw new Error('Stripe failed to load');
//   const elements = stripe.elements();
//   const card = elements.create('card');
//   card.mount('#card-element');
//   const { paymentIntent, error } = await stripe.confirmCardPayment(
//     clientSecret,
//     { payment_method: { card } },
//   );
//
// Module-scoped singletons cache the script promise + the stripe instance
// per publishable key so re-mounting the component never injects the
// script twice or constructs two Stripe instances. Tests inject a mock
// Stripe via `__setStripeFactory()`.
//
// `confirmCardPayment` is CLIENT-ONLY by Stripe design — the secret key
// stays on the server, the publishable key + clientSecret + card element
// stay in the browser. We never see the raw card number; Stripe Elements
// owns the iframe that contains the input.

// ---------------------------------------------------------------------------
// Minimal type surface — we deliberately do not depend on @stripe/stripe-js
// because the runtime arrives from the CDN, not from node_modules. The
// shape below is the v3 API we use; it intentionally undertypes Stripe's
// full surface area.
// ---------------------------------------------------------------------------

export interface StripeElementsInstance {
	create(elementType: 'card', opts?: Record<string, unknown>): StripeCardElement;
}

export interface StripeCardElement {
	mount(domNode: HTMLElement | string): void;
	unmount(): void;
	destroy(): void;
	on(event: string, handler: (e: { error?: { message: string } }) => void): void;
}

export interface StripePaymentIntentResult {
	paymentIntent?: {
		id: string;
		status:
			| 'requires_payment_method'
			| 'requires_confirmation'
			| 'requires_action'
			| 'processing'
			| 'requires_capture'
			| 'canceled'
			| 'succeeded';
		client_secret?: string;
	};
	error?: {
		type: string;
		code?: string;
		message: string;
	};
}

export interface StripeInstance {
	elements(opts?: Record<string, unknown>): StripeElementsInstance;
	confirmCardPayment(
		clientSecret: string,
		opts: { payment_method: { card: StripeCardElement; billing_details?: Record<string, unknown> } },
	): Promise<StripePaymentIntentResult>;
	retrievePaymentIntent(clientSecret: string): Promise<StripePaymentIntentResult>;
}

type StripeFactory = (publishableKey: string) => StripeInstance;

// Window augmentation — Stripe.js sets `window.Stripe` after the script
// loads.
declare global {
	interface Window {
		Stripe?: StripeFactory;
	}
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const STRIPE_SCRIPT_URL = 'https://js.stripe.com/v3/';

// `_scriptLoadedPromise` resolves once the Stripe.js <script> has fired its
// `load` event (or we discover window.Stripe was already attached). It is
// kept across the lifetime of the module on the SUCCESS path so HMR /
// retries serialize against a single load. On the ERROR path it is cleared
// in the inner Promise's reject handler so a later retry can re-inject.
let _scriptLoadedPromise: Promise<StripeFactory> | null = null;
const _instanceCache = new Map<string, StripeInstance>();
let _factoryOverride: StripeFactory | null = null;
// Last error captured on a null-return path. Surfaced via getLastStripeLoadError()
// so debugging surfaces can tell apart "no window" / "CSP block" / "Stripe ctor threw".
let _lastError: Error | null = null;

/** Reset module state — tests + HMR only. */
export function __resetStripeLoader(): void {
	_scriptLoadedPromise = null;
	_instanceCache.clear();
	_factoryOverride = null;
	_lastError = null;
}

/**
 * Test seam: inject a synthetic Stripe factory so unit tests don't have
 * to mount a real CDN script. Set to `null` to restore production CDN
 * loading. Calling `__setStripeFactory(fn)` short-circuits `loadStripe()`
 * so neither the `<script>` tag nor `window.Stripe` is touched.
 */
export function __setStripeFactory(factory: StripeFactory | null): void {
	_factoryOverride = factory;
	_scriptLoadedPromise = null;
	_instanceCache.clear();
	_lastError = null;
}

/**
 * Surfaces the last underlying Error captured by a `loadStripe()` null
 * return so debugging UI / structured logs can disambiguate CSP block vs
 * no-window vs Stripe-ctor-threw. Returns null when the last load
 * succeeded or no load has been attempted.
 */
export function getLastStripeLoadError(): Error | null {
	return _lastError;
}

/**
 * Lazy-load Stripe.js v3 from the official CDN and construct a Stripe
 * instance bound to `publishableKey`. Caches the instance per key so
 * subsequent calls are synchronous-ish (still returns a Promise for API
 * uniformity).
 *
 * Returns `null` if loading fails (no `window`, script error, CSP block).
 * Callers MUST handle the null case and fall back to the test-mode form.
 * Inspect `getLastStripeLoadError()` for the underlying cause.
 */
export async function loadStripe(publishableKey: string): Promise<StripeInstance | null> {
	if (!publishableKey || typeof publishableKey !== 'string') {
		_lastError = new Error('invalid_publishable_key');
		return null;
	}
	// Cache hit
	const cached = _instanceCache.get(publishableKey);
	if (cached) return cached;

	let factory: StripeFactory | null;
	try {
		factory = await _resolveFactory();
	} catch (err) {
		_lastError = err instanceof Error ? err : new Error(String(err));
		console.error('[StripeElementsLoader] factory resolution failed:', _lastError);
		return null;
	}
	if (!factory) {
		// _resolveFactory already set _lastError on its known null paths
		// (SSR detection) — leave that value alone here.
		return null;
	}

	let instance: StripeInstance;
	try {
		instance = factory(publishableKey);
	} catch (err) {
		_lastError = err instanceof Error ? err : new Error(String(err));
		console.error('[StripeElementsLoader] Stripe(publishableKey) threw:', _lastError);
		return null;
	}
	_lastError = null;
	_instanceCache.set(publishableKey, instance);
	return instance;
}

/**
 * Resolve the Stripe factory function. Order:
 *  1. Test override via `__setStripeFactory()`.
 *  2. Already-attached `window.Stripe` (script previously loaded).
 *  3. Inject `<script src="https://js.stripe.com/v3/">` and wait for load.
 *
 * Throws on environments without `document` (SSR) — caller catches.
 */
async function _resolveFactory(): Promise<StripeFactory | null> {
	if (_factoryOverride) return _factoryOverride;
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		_lastError = new Error('no_browser_environment');
		return null;
	}
	if (window.Stripe) return window.Stripe;
	if (_scriptLoadedPromise) return _scriptLoadedPromise;

	_scriptLoadedPromise = new Promise<StripeFactory>((resolve, reject) => {
		// Re-use existing script tag if present (HMR / double-mount).
		const existing = document.querySelector<HTMLScriptElement>(
			`script[src="${STRIPE_SCRIPT_URL}"]`,
		);
		const onLoad = (): void => {
			if (window.Stripe) resolve(window.Stripe);
			else reject(new Error('Stripe script loaded but window.Stripe missing'));
		};
		const onError = (): void => reject(new Error('Failed to load Stripe.js'));

		if (existing) {
			if (window.Stripe) {
				resolve(window.Stripe);
				return;
			}
			existing.addEventListener('load', onLoad);
			existing.addEventListener('error', onError);
			return;
		}
		const script = document.createElement('script');
		script.src = STRIPE_SCRIPT_URL;
		script.async = true;
		// SECURITY NOTE: Stripe.js v3 is intentionally NOT loaded with an
		// `integrity=` Subresource Integrity hash. Stripe updates the
		// hosted script in-place for the live anti-fraud + 3DS layers, so
		// pinning a hash would break PCI compliance + payment flow within
		// hours of any Stripe-side update. Stripe's docs explicitly forbid
		// SRI and self-hosting (https://docs.stripe.com/js — "Always load
		// Stripe.js directly from js.stripe.com"). Trust here is anchored
		// by HTTPS + Stripe's own controls on js.stripe.com, NOT SRI.
		//
		// We deliberately do NOT set `script.crossOrigin = 'anonymous'`.
		// Stripe's official `@stripe/stripe-js` loader does not set
		// crossOrigin on the script tag (see https://github.com/stripe/stripe-js
		// — the upstream loader); deviating risks future CDN cache-key /
		// credential-handling behavior changes silently breaking payments.
		// If CSP issues arise in practice, address them via a
		// `script-src https://js.stripe.com` directive in the CSP header.
		script.addEventListener('load', onLoad);
		script.addEventListener('error', onError);
		document.head.appendChild(script);
	}).catch((err) => {
		// Script-load error path: clear the cached promise so a retry can
		// re-inject the script (e.g. after a transient network blip).
		// Captures the cause for getLastStripeLoadError().
		_scriptLoadedPromise = null;
		_lastError = err instanceof Error ? err : new Error(String(err));
		console.error('[StripeElementsLoader] script load failed:', _lastError);
		// Re-throw so loadStripe()'s outer catch surfaces the null return.
		throw _lastError;
	});

	return _scriptLoadedPromise;
}

/**
 * Read the build-time PUBLIC_STRIPE_PUBLISHABLE_KEY from `$env/static/public`.
 * Returns `''` when unset, signaling "fall back to test-mode form".
 *
 * The `$env/static/public` import is statically resolved by SvelteKit's
 * bundler at build time (only `PUBLIC_*`-prefixed env vars are exposed —
 * see https://kit.svelte.dev/docs/modules#$env-static-public). For vitest
 * we alias the module to a stub in `vitest.config.ts` so this helper is
 * importable without the SvelteKit build pipeline. The stub returns the
 * empty string by default; tests that want to exercise the
 * `useRealStripe=true` branch override via `__setPublishableKeyForTests()`.
 *
 * Exported separately so tests can mock the value without touching the
 * actual Vite env.
 */
import { PUBLIC_STRIPE_PUBLISHABLE_KEY } from '$env/static/public';

// Test-only override surface — production code path always returns the
// statically-bundled env value.
let _publishableKeyOverride: string | null = null;

export function __setPublishableKeyForTests(key: string | null): void {
	_publishableKeyOverride = key;
}

export function readPublishableKey(): string {
	if (_publishableKeyOverride !== null) return _publishableKeyOverride;
	return typeof PUBLIC_STRIPE_PUBLISHABLE_KEY === 'string'
		? PUBLIC_STRIPE_PUBLISHABLE_KEY
		: '';
}
