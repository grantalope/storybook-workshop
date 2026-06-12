// tests/storybook-workshop/subscription/autopilot-drafter.test.ts
//
// Covers:
// - cadence trigger drafts a book when nextBookAt has arrived
// - 7-day default-no-ship: expired drafts marked 'defaulted'
// - weekly batch: 4 drafts at once with 14-day window
// - respond approve / redo / swap_theme
// - parent-approve email sent on draft creation
// - default-no-ship email on expiry
// - schedulePeriodic wired through provided scheduler (no raw setInterval)

import { describe, it, expect, beforeEach } from 'vitest';
import {
	APPROVAL_WINDOW_DAYS,
	AutopilotDrafter,
	BundleService,
	MS_PER_DAY,
	SubscriptionService,
	WEEKLY_BATCH_APPROVAL_WINDOW_DAYS,
	WEEKLY_BATCH_SIZE,
	nextCadenceAt,
} from '$lib/services/subscription';
import {
	createMockAuthor,
	createMockMailer,
	createMockPayment,
	createMockScheduler,
	makeClock,
	makeIdGen,
} from './fixtures';

describe('AutopilotDrafter — basic cadence draft', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let mailer: ReturnType<typeof createMockMailer>;
	let author: ReturnType<typeof createMockAuthor>;
	let scheduler: ReturnType<typeof createMockScheduler>;
	let subs: SubscriptionService;
	let drafter: AutopilotDrafter;
	let clock: ReturnType<typeof makeClock>;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		mailer = createMockMailer();
		author = createMockAuthor();
		scheduler = createMockScheduler();
		clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
		drafter.start();
	});

	it('schedulePeriodic is wired via the kernel scheduler (no raw setInterval)', () => {
		expect(scheduler.tasks).toHaveLength(1);
		expect(scheduler.tasks[0].name).toBe('autopilot-drafter-tick');
	});

	it('start is idempotent', () => {
		drafter.start();
		drafter.start();
		expect(scheduler.tasks).toHaveLength(1);
	});

	it('drafts ONE book for monthly cadence at trigger time', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			kidId: 'kid-1',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
			seriesThemeId: 'series.big-feelings',
		});
		// nextBookAt is now == T0 → immediately due
		const drafts = await drafter.maybeDraftFor(sub.id);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].status).toBe('pending_approval');
		expect(drafts[0].approvalDeadline - T0).toBe(APPROVAL_WINDOW_DAYS * MS_PER_DAY);
		expect(sub.activeDraftIds).toEqual([drafts[0].id]);
		expect(author.calls).toHaveLength(1);
		expect(mailer.calls.find((c) => c.kind === 'autopilot_draft_ready')).toBeDefined();
	});

	it('does NOT draft when nextBookAt is in the future', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		// Push nextBookAt forward
		sub.nextBookAt = T0 + 30 * MS_PER_DAY;
		const drafts = await drafter.maybeDraftFor(sub.id);
		expect(drafts).toHaveLength(0);
	});

	it('does NOT draft when autopilotEnabled=false', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
			autopilotEnabled: false,
		});
		const drafts = await drafter.maybeDraftFor(sub.id);
		expect(drafts).toHaveLength(0);
	});

	it('does NOT create a 2nd draft when one is in-flight', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await drafter.maybeDraftFor(sub.id);
		const second = await drafter.maybeDraftFor(sub.id);
		expect(second).toHaveLength(0);
	});
});

describe('AutopilotDrafter — weekly batch', () => {
	let drafter: AutopilotDrafter;
	let subs: SubscriptionService;
	let author: ReturnType<typeof createMockAuthor>;
	let clock: ReturnType<typeof makeClock>;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		const payment = createMockPayment();
		const mailer = createMockMailer();
		author = createMockAuthor();
		const scheduler = createMockScheduler();
		clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
	});

	it('creates WEEKLY_BATCH_SIZE drafts with WEEKLY_BATCH_APPROVAL_WINDOW_DAYS deadline', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'weekly',
			format: 'softcover',
			billingMode: 'recurring',
			seriesThemeId: 'series.year-of-adventures',
		});
		const drafts = await drafter.maybeDraftFor(sub.id);
		expect(drafts).toHaveLength(WEEKLY_BATCH_SIZE);
		expect(author.calls).toHaveLength(WEEKLY_BATCH_SIZE);
		for (const d of drafts) {
			expect(d.approvalDeadline - T0).toBe(WEEKLY_BATCH_APPROVAL_WINDOW_DAYS * MS_PER_DAY);
		}
		expect(sub.activeDraftIds).toHaveLength(WEEKLY_BATCH_SIZE);
	});

	it('weekly batch pulls 4 distinct themes from the series', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'weekly',
			format: 'softcover',
			billingMode: 'recurring',
			seriesThemeId: 'series.big-feelings',
		});
		const drafts = await drafter.maybeDraftFor(sub.id);
		const themes = drafts.map((d) => d.themeId);
		expect(new Set(themes).size).toBe(WEEKLY_BATCH_SIZE);
	});
});

describe('AutopilotDrafter.tick — 7-day default-no-ship', () => {
	let drafter: AutopilotDrafter;
	let subs: SubscriptionService;
	let mailer: ReturnType<typeof createMockMailer>;
	let clock: ReturnType<typeof makeClock>;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		const payment = createMockPayment();
		mailer = createMockMailer();
		const author = createMockAuthor();
		const scheduler = createMockScheduler();
		clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
	});

	it('marks expired draft as defaulted + sends default-no-ship email', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const drafts = await drafter.maybeDraftFor(sub.id);
		const draft = drafts[0];
		expect(draft.status).toBe('pending_approval');

		// Jump clock past the 7-day window
		clock.advance(APPROVAL_WINDOW_DAYS * MS_PER_DAY + 1000);
		const result = await drafter.tick();
		expect(result.draftsDefaulted).toBe(1);
		expect(draft.status).toBe('defaulted');
		expect(draft.defaultedAt).toBeDefined();
		expect(mailer.calls.find((c) => c.kind === 'autopilot_default_no_ship')).toBeDefined();
		// Active drafts cleared from sub
		expect(sub.activeDraftIds).toHaveLength(0);
	});

	it('non-expired draft stays pending_approval', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const drafts = await drafter.maybeDraftFor(sub.id);
		const draft = drafts[0];
		clock.advance(1 * MS_PER_DAY); // only 1 day
		await drafter.tick();
		expect(draft.status).toBe('pending_approval');
	});
});

describe('AutopilotDrafter.respond', () => {
	let drafter: AutopilotDrafter;
	let subs: SubscriptionService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		const payment = createMockPayment();
		const mailer = createMockMailer();
		const author = createMockAuthor();
		const scheduler = createMockScheduler();
		const clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
	});

	it('approve flips status to approved', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		const updated = await drafter.respond({
			subscriptionId: sub.id,
			draftId: draft.id,
			action: 'approve',
		});
		expect(updated.status).toBe('approved');
		expect(updated.approvedAt).toBeDefined();
	});

	it('redo flips status to redo_requested', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		const updated = await drafter.respond({
			subscriptionId: sub.id,
			draftId: draft.id,
			action: 'redo',
		});
		expect(updated.status).toBe('redo_requested');
	});

	it('swap_theme updates themeId + status', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		const updated = await drafter.respond({
			subscriptionId: sub.id,
			draftId: draft.id,
			action: 'swap_theme',
			newThemeId: 'theme.other',
		});
		expect(updated.status).toBe('theme_swapped');
		expect(updated.themeId).toBe('theme.other');
	});

	it('swap_theme without newThemeId throws', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		await expect(
			drafter.respond({
				subscriptionId: sub.id,
				draftId: draft.id,
				action: 'swap_theme',
			})
		).rejects.toThrow(/newThemeId/);
	});

	it('respond on wrong subscription id throws', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		await expect(
			drafter.respond({
				subscriptionId: 'sub_bogus',
				draftId: draft.id,
				action: 'approve',
			})
		).rejects.toThrow(/not bound/);
	});
});

describe('AutopilotDrafter.tick — nextBookAt advances after default (P1 regression)', () => {
	let drafter: AutopilotDrafter;
	let subs: SubscriptionService;
	let mailer: ReturnType<typeof createMockMailer>;
	let author: ReturnType<typeof createMockAuthor>;
	let clock: ReturnType<typeof makeClock>;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		const payment = createMockPayment();
		mailer = createMockMailer();
		author = createMockAuthor();
		const scheduler = createMockScheduler();
		clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
	});

	it('nextBookAt advances one cadence interval after a draft defaults', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const nextBookAtBefore = sub.nextBookAt;
		await drafter.maybeDraftFor(sub.id);

		// Expire the draft
		clock.advance(APPROVAL_WINDOW_DAYS * MS_PER_DAY + 1000);
		await drafter.tick();

		// nextBookAt must have advanced by one monthly cadence interval
		expect(sub.nextBookAt).toBe(nextCadenceAt(nextBookAtBefore, 'monthly'));
	});

	it('can create a new draft in the NEXT tick after previous draft defaulted', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await drafter.maybeDraftFor(sub.id);

		// Expire and tick — default the draft
		clock.advance(APPROVAL_WINDOW_DAYS * MS_PER_DAY + 1000);
		await drafter.tick();

		// Advance clock past the new nextBookAt (T0 + 30 days) so the cadence fires
		clock.advance(30 * MS_PER_DAY);
		const newDrafts = await drafter.maybeDraftFor(sub.id);
		expect(newDrafts).toHaveLength(1);
		expect(newDrafts[0].status).toBe('pending_approval');
	});
});

describe('AutopilotDrafter.respond — approve clears activeDraftIds (P1 regression)', () => {
	let drafter: AutopilotDrafter;
	let subs: SubscriptionService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		const payment = createMockPayment();
		const mailer = createMockMailer();
		const author = createMockAuthor();
		const scheduler = createMockScheduler();
		const clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		drafter = new AutopilotDrafter({
			subscriptions: subs,
			author,
			mailer,
			scheduler,
			nowSource: clock.now,
			idGen: makeIdGen('draft'),
		});
	});

	it('approve removes draftId from sub.activeDraftIds', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);
		expect(sub.activeDraftIds).toContain(draft.id);

		await drafter.respond({
			subscriptionId: sub.id,
			draftId: draft.id,
			action: 'approve',
		});

		expect(sub.activeDraftIds).not.toContain(draft.id);
		expect(sub.activeDraftIds).toHaveLength(0);
	});

	it('after approve, next maybeDraftFor can queue the subsequent draft', async () => {
		const sub = await subs.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const [draft] = await drafter.maybeDraftFor(sub.id);

		await drafter.respond({
			subscriptionId: sub.id,
			draftId: draft.id,
			action: 'approve',
		});

		// With slot cleared, maybeDraftFor should succeed (nextBookAt is still at T0 == now)
		const next = await drafter.maybeDraftFor(sub.id);
		expect(next).toHaveLength(1);
	});
});
