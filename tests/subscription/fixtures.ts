// tests/storybook-workshop/subscription/fixtures.ts
//
// Shared test doubles + helpers for subscription engine tests.

import type {
	MailerProvider,
	PaymentProvider,
	PeriodicScheduler,
	StoryAuthorHook,
} from '$lib/services/subscription/types';

// ---------------------------------------------------------------------------
// Mock PaymentProvider
// ---------------------------------------------------------------------------

export interface MockPaymentCall {
	method:
		| 'createSubscription'
		| 'cancelSubscription'
		| 'createOneTimeCharge'
		| 'createGiftCheckoutSession';
	args: unknown;
	returned: unknown;
}

export function createMockPayment(): PaymentProvider & {
	calls: MockPaymentCall[];
	subCounter: number;
	chargeCounter: number;
	checkoutCounter: number;
} {
	const calls: MockPaymentCall[] = [];
	let subCounter = 0;
	let chargeCounter = 0;
	let checkoutCounter = 0;
	const m = {
		calls,
		get subCounter() {
			return subCounter;
		},
		get chargeCounter() {
			return chargeCounter;
		},
		get checkoutCounter() {
			return checkoutCounter;
		},
		async createSubscription(opts: Parameters<PaymentProvider['createSubscription']>[0]) {
			subCounter += 1;
			const out = { stripeSubscriptionId: `sub_stripe_${subCounter}` };
			calls.push({ method: 'createSubscription', args: opts, returned: out });
			return out;
		},
		async cancelSubscription(id: string) {
			calls.push({ method: 'cancelSubscription', args: { id }, returned: undefined });
		},
		async createOneTimeCharge(opts: Parameters<PaymentProvider['createOneTimeCharge']>[0]) {
			chargeCounter += 1;
			const out = { stripePaymentIntentId: `pi_${chargeCounter}` };
			calls.push({ method: 'createOneTimeCharge', args: opts, returned: out });
			return out;
		},
		async createGiftCheckoutSession(
			opts: Parameters<PaymentProvider['createGiftCheckoutSession']>[0]
		) {
			checkoutCounter += 1;
			const out = { stripeCheckoutId: `cs_${checkoutCounter}` };
			calls.push({ method: 'createGiftCheckoutSession', args: opts, returned: out });
			return out;
		},
	};
	return m as PaymentProvider & {
		calls: MockPaymentCall[];
		subCounter: number;
		chargeCounter: number;
		checkoutCounter: number;
	};
}

// ---------------------------------------------------------------------------
// Mock MailerProvider
// ---------------------------------------------------------------------------

export interface MockMailCall {
	to: string;
	kind: string;
	variables: Record<string, string>;
	messageId: string;
}

export function createMockMailer(): MailerProvider & { calls: MockMailCall[] } {
	const calls: MockMailCall[] = [];
	let counter = 0;
	return {
		calls,
		async send(opts) {
			counter += 1;
			const messageId = `msg_${counter}`;
			calls.push({
				to: opts.to,
				kind: opts.kind,
				variables: opts.variables,
				messageId,
			});
			return { messageId };
		},
	};
}

// ---------------------------------------------------------------------------
// Mock StoryAuthorHook
// ---------------------------------------------------------------------------

export interface MockAuthorCall {
	subscriptionId: string;
	themeId: string;
	previewShortcode: string;
}

export function createMockAuthor(): StoryAuthorHook & { calls: MockAuthorCall[] } {
	const calls: MockAuthorCall[] = [];
	let counter = 0;
	return {
		calls,
		async authorDraft(opts) {
			counter += 1;
			const previewShortcode = `pv_${counter}`;
			calls.push({
				subscriptionId: opts.subscriptionId,
				themeId: opts.themeId,
				previewShortcode,
			});
			return { previewShortcode };
		},
	};
}

// ---------------------------------------------------------------------------
// Mock PeriodicScheduler (manual tick driver)
// ---------------------------------------------------------------------------

export interface MockScheduledTask {
	name: string;
	fn: () => Promise<void> | void;
	intervalMs: number;
	cancelled: boolean;
}

export function createMockScheduler(): PeriodicScheduler & {
	tasks: MockScheduledTask[];
	runAll(): Promise<void>;
} {
	const tasks: MockScheduledTask[] = [];
	return {
		tasks,
		schedulePeriodic(name, fn, opts) {
			const t: MockScheduledTask = { name, fn, intervalMs: opts.intervalMs, cancelled: false };
			tasks.push(t);
			return {
				cancel() {
					t.cancelled = true;
				},
			};
		},
		async runAll() {
			for (const t of tasks) {
				if (!t.cancelled) await t.fn();
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Deterministic clock + id helpers
// ---------------------------------------------------------------------------

export function makeClock(startMs: number) {
	let t = startMs;
	return {
		now: () => t,
		advance(ms: number) {
			t += ms;
		},
		set(ms: number) {
			t = ms;
		},
	};
}

let _idCounter = 0;
export function makeIdGen(prefix = 'id'): () => string {
	return () => {
		_idCounter += 1;
		return `${prefix}_${_idCounter}`;
	};
}

let _shortcodeCounter = 0;
export function makeRedeemCodeGen(): () => string {
	return () => {
		_shortcodeCounter += 1;
		return `RDM${_shortcodeCounter.toString().padStart(7, '0')}`;
	};
}

let _refShortcodeCounter = 0;
export function makeReferralShortcodeGen(): () => string {
	return () => {
		_refShortcodeCounter += 1;
		return `ref${_refShortcodeCounter.toString().padStart(5, '0')}`;
	};
}

// Reset counters between test files (each file imports fresh; counters are
// module-level so they persist across tests in the same file — that's fine
// since we only assert IDs are *distinct*, not on absolute values).
