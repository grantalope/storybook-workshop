// @graph-layer: private
// @rationale: private (test-isolatable gate logic for Station 7's payment swap)
//
// src/lib/workshop/services/stripeElementsGate.ts
//
// Pure, DOM-free gate logic for Station 7's Stripe Elements vs test-mode
// card-form swap. Extracted from `Station7TakeHome.svelte` so the swap
// decision + 3DS / requires_action handling are unit-testable WITHOUT
// mounting the Svelte component (which would require `@testing-library/svelte`
// + jsdom env config + a full Svelte 5 effect runtime in vitest).
//
// The Svelte component imports `decideStripePath` + `handlePaymentIntentResult`
// and delegates the gate / 3DS dispatch to this module. Component-side
// state (DOM mount nodes, $state runes) is the ONLY thing that stays in
// the .svelte file.

import type { StripeInstance, StripePaymentIntentResult } from '$lib/workshop/components/StripeElementsLoader';

/**
 * Decide whether Station 7 should mount real Stripe Elements or fall back
 * to the legacy test-mode card-number `<input>`. Real Stripe activates
 * when:
 *   - the build was wired with a non-empty PUBLIC_STRIPE_PUBLISHABLE_KEY, AND
 *   - the component was NOT explicitly forced into dev/test mode.
 */
export interface StripePathDecision {
	useRealStripe: boolean;
	reason: 'no_key' | 'dev_mode' | 'real_stripe';
}

export function decideStripePath(opts: {
	publishableKey: string;
	devMode: boolean;
}): StripePathDecision {
	if (opts.devMode) return { useRealStripe: false, reason: 'dev_mode' };
	if (!opts.publishableKey || opts.publishableKey.length === 0) {
		return { useRealStripe: false, reason: 'no_key' };
	}
	return { useRealStripe: true, reason: 'real_stripe' };
}

/**
 * Outcome of evaluating `stripe.confirmCardPayment()`'s return shape.
 * Drives the component's phase transition + error surfacing without the
 * component having to inspect the raw Stripe result shape.
 */
export type PaymentOutcome =
	| { kind: 'succeeded' }
	| { kind: 'requires_action'; userMessage: string }
	| { kind: 'requires_payment_method'; userMessage: string }
	| { kind: 'error'; userMessage: string }
	| { kind: 'other_pending'; status: string; userMessage: string };

/**
 * Map a `StripePaymentIntentResult` to a `PaymentOutcome`. Handles 3DS /
 * requires_action explicitly — the v1 implementation conflated any
 * non-succeeded status with a hard error, which is wrong for PSD2 + most
 * EU cards (and a growing fraction of US cards). Per Stripe docs, when
 * `requires_action` fires, Stripe.js has already triggered the inline 3DS
 * modal; once the modal closes we re-poll via `retrievePaymentIntent` to
 * detect the post-challenge `succeeded` state (the component is
 * responsible for the actual re-poll — this function just classifies).
 *
 * https://docs.stripe.com/payments/payment-intents/web-manual#handle-redirect
 */
export function handlePaymentIntentResult(
	result: StripePaymentIntentResult,
): PaymentOutcome {
	if (result.error) {
		return { kind: 'error', userMessage: result.error.message };
	}
	const status = result.paymentIntent?.status;
	if (status === 'succeeded') return { kind: 'succeeded' };
	if (status === 'requires_action') {
		return {
			kind: 'requires_action',
			userMessage:
				'Please complete bank verification in the popup, then we will finish your order.',
		};
	}
	if (status === 'requires_payment_method') {
		return {
			kind: 'requires_payment_method',
			userMessage: 'Your card was declined. Please try a different card.',
		};
	}
	return {
		kind: 'other_pending',
		status: status ?? 'unknown',
		userMessage: `Payment is still ${status ?? 'pending'}. Please wait or try again.`,
	};
}

/**
 * After a `requires_action` outcome, re-poll the PaymentIntent state by
 * calling `stripe.retrievePaymentIntent(clientSecret)`. Stripe.js shows
 * the 3DS challenge inline; this helper waits for the post-challenge
 * status. Returns the same `PaymentOutcome` shape the caller already
 * branches on.
 *
 * This is intentionally a separate function from `handlePaymentIntentResult`
 * so the component can show "complete bank verification" guidance + a
 * Retry button before triggering the re-poll, rather than blocking the UI
 * on an indefinite Stripe round-trip.
 */
export async function pollAfter3DS(
	stripe: StripeInstance,
	clientSecret: string,
): Promise<PaymentOutcome> {
	const retrieved = await stripe.retrievePaymentIntent(clientSecret);
	return handlePaymentIntentResult(retrieved);
}
