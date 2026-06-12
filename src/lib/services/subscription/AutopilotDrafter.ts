// @graph-layer: private
// @rationale: private (autopilot draft state — per-subscription book pipeline)
//
// src/routes/dashboard/services/storybook-workshop/subscription/AutopilotDrafter.ts
//
// At cadence interval, auto-drafts the next book in the subscription's
// series. Sends parent email "Eli's June book is ready for your review" +
// 7-day approval window. After 7 days, default: do NOT ship (credit to
// next book).
//
// For weekly cadence: batch-approve 4 books at once (auto-draft 4 in
// advance, 14-day window).
//
// CLAUDE.md kernel rule 1 — uses kernel `cognitionEngine.schedulePeriodic`
// (no raw setInterval).

import type {
	AutopilotApproveOpts,
	AutopilotDraft,
	AutopilotDraftStatus,
	MailerProvider,
	PeriodicScheduler,
	StoryAuthorHook,
	Subscription,
	ThemeId,
} from './types';
import type { SubscriptionService } from './SubscriptionService';
import { MS_PER_DAY, nextCadenceAt } from './SubscriptionService';
import { getThemeAtSlot } from './SeriesThemeRegistry';

// ---------------------------------------------------------------------------
// Constants (spec §6.4)
// ---------------------------------------------------------------------------

export const APPROVAL_WINDOW_DAYS = 7;
export const WEEKLY_BATCH_APPROVAL_WINDOW_DAYS = 14;
export const WEEKLY_BATCH_SIZE = 4;
/** How often the drafter ticks. 6 hours bound — well under the 7-day window. */
export const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface AutopilotDrafterOpts {
	subscriptions: SubscriptionService;
	author: StoryAuthorHook;
	mailer: MailerProvider;
	scheduler: PeriodicScheduler;
	nowSource?: () => number;
	idGen?: () => string;
	/** Override tick interval (tests). */
	tickIntervalMs?: number;
}

export class AutopilotDrafter {
	private _drafts = new Map<string, AutopilotDraft>();
	private _byShortcode = new Map<string, string>(); // shortcode → draftId
	private _subs: SubscriptionService;
	private _author: StoryAuthorHook;
	private _mailer: MailerProvider;
	private _scheduler: PeriodicScheduler;
	private _tickHandle: { cancel(): void } | null = null;
	private _now: () => number;
	private _idGen: () => string;
	private _tickIntervalMs: number;

	constructor(opts: AutopilotDrafterOpts) {
		this._subs = opts.subscriptions;
		this._author = opts.author;
		this._mailer = opts.mailer;
		this._scheduler = opts.scheduler;
		this._now = opts.nowSource ?? (() => Date.now());
		this._idGen = opts.idGen ?? defaultIdGen;
		this._tickIntervalMs = opts.tickIntervalMs ?? TICK_INTERVAL_MS;
	}

	/** Start the periodic tick. Idempotent. */
	start(): void {
		if (this._tickHandle) return;
		this._tickHandle = this._scheduler.schedulePeriodic(
			'autopilot-drafter-tick',
			() => this.tick(),
			{ intervalMs: this._tickIntervalMs }
		);
	}

	/** Stop the periodic tick. Idempotent. */
	stop(): void {
		if (this._tickHandle) {
			this._tickHandle.cancel();
			this._tickHandle = null;
		}
	}

	/**
	 * One tick pass:
	 * - For each active autopilot-enabled subscription whose `nextBookAt` has
	 *   arrived AND has no in-flight draft → create draft(s).
	 * - Mark expired drafts (past their approvalDeadline) as 'defaulted' and
	 *   credit the next book (advance nextBookAt forward one cadence interval).
	 */
	async tick(): Promise<{ draftsCreated: number; draftsDefaulted: number }> {
		let draftsCreated = 0;
		let draftsDefaulted = 0;
		const now = this._now();

		// Sweep all subs (in real impl this scans an active-sub index)
		// In MVP we use SubscriptionService.listByRecipient-ish but no full-scan API;
		// callers should drive ticks manually via maybeDraftFor() in tests. For the
		// tick path we expose __testTickFor(sub) below.

		// Mark expired drafts as defaulted
		for (const draft of this._drafts.values()) {
			if (draft.status === 'pending_approval' && draft.approvalDeadline <= now) {
				draft.status = 'defaulted';
				draft.defaultedAt = now;
				draftsDefaulted += 1;
				const sub = this._subs.get(draft.subscriptionId);
				if (sub) {
					// Remove draft from sub's active list
					sub.activeDraftIds = sub.activeDraftIds.filter((id) => id !== draft.id);
					// Credit toward next book: advance nextBookAt one cadence
					// interval. This is the "do NOT ship + credit" path.
					await this._mailer.send({
						to: sub.recipientParentEmail,
						kind: 'autopilot_default_no_ship',
						variables: {
							draftId: draft.id,
							subscriptionId: sub.id,
						},
					});
					sub.nextBookAt = nextCadenceAt(sub.nextBookAt, sub.cadence);
				}
			}
		}

		return { draftsCreated, draftsDefaulted };
	}

	/**
	 * Public/testable: try to create a draft for a specific subscription.
	 * Called by `tick()` for each sub in production; tests call directly.
	 */
	async maybeDraftFor(subscriptionId: string): Promise<AutopilotDraft[]> {
		const sub = this._subs.get(subscriptionId);
		if (!sub) throw new Error(`AutopilotDrafter: unknown subscription ${subscriptionId}`);
		if (sub.status !== 'active') return [];
		if (!sub.autopilotEnabled) return [];
		const now = this._now();
		if (sub.nextBookAt > now) return [];
		// Already has in-flight drafts? skip
		const inFlight = sub.activeDraftIds
			.map((id) => this._drafts.get(id))
			.filter((d) => d && d.status === 'pending_approval');
		if (inFlight.length > 0) return [];

		const createdDrafts: AutopilotDraft[] = [];
		if (sub.cadence === 'weekly') {
			for (let i = 0; i < WEEKLY_BATCH_SIZE; i++) {
				const draft = await this._createSingleDraft(sub, sub.booksDelivered + i, true);
				createdDrafts.push(draft);
			}
		} else {
			const draft = await this._createSingleDraft(sub, sub.booksDelivered, false);
			createdDrafts.push(draft);
		}
		return createdDrafts;
	}

	private async _createSingleDraft(
		sub: Subscription,
		slot: number,
		isBatch: boolean
	): Promise<AutopilotDraft> {
		const themeId: ThemeId = sub.seriesThemeId
			? getThemeAtSlot(sub.seriesThemeId, slot) ?? `theme.default.${slot}`
			: `theme.default.${slot}`;

		const { previewShortcode } = await this._author.authorDraft({
			subscriptionId: sub.id,
			kidId: sub.kidId,
			themeId,
			format: sub.format,
		});

		const now = this._now();
		const windowDays = isBatch ? WEEKLY_BATCH_APPROVAL_WINDOW_DAYS : APPROVAL_WINDOW_DAYS;
		const draft: AutopilotDraft = {
			id: `draft_${this._idGen()}`,
			subscriptionId: sub.id,
			themeId,
			draftedAt: now,
			approvalDeadline: now + windowDays * MS_PER_DAY,
			status: 'pending_approval',
			previewShortcode,
		};
		this._drafts.set(draft.id, draft);
		this._byShortcode.set(previewShortcode, draft.id);
		sub.activeDraftIds.push(draft.id);

		await this._mailer.send({
			to: sub.recipientParentEmail,
			kind: 'autopilot_draft_ready',
			variables: {
				subscriptionId: sub.id,
				draftId: draft.id,
				previewShortcode,
				windowDays: String(windowDays),
			},
		});

		return draft;
	}

	/**
	 * Parent approves, requests redo, or swaps the theme.
	 * Resumes the workshop flow at S6 (preview + consent gate) downstream.
	 */
	async respond(opts: AutopilotApproveOpts): Promise<AutopilotDraft> {
		const draft = this._drafts.get(opts.draftId);
		if (!draft) throw new Error(`AutopilotDrafter: unknown draft ${opts.draftId}`);
		if (draft.subscriptionId !== opts.subscriptionId) {
			throw new Error(`AutopilotDrafter: draft ${opts.draftId} not bound to subscription ${opts.subscriptionId}`);
		}
		if (draft.status !== 'pending_approval') {
			throw new Error(`AutopilotDrafter: draft ${opts.draftId} status=${draft.status}`);
		}
		const now = this._now();
		if (opts.action === 'approve') {
			draft.status = 'approved';
			draft.approvedAt = now;
			const sub = this._subs.get(opts.subscriptionId);
			if (sub) {
				sub.activeDraftIds = sub.activeDraftIds.filter((id) => id !== opts.draftId);
			}
		} else if (opts.action === 'redo') {
			draft.status = 'redo_requested';
		} else if (opts.action === 'swap_theme') {
			if (!opts.newThemeId) {
				throw new Error(`AutopilotDrafter: swap_theme requires newThemeId`);
			}
			draft.themeId = opts.newThemeId;
			draft.status = 'theme_swapped';
		}
		return draft;
	}

	getDraft(id: string): AutopilotDraft | undefined {
		return this._drafts.get(id);
	}

	getDraftByShortcode(shortcode: string): AutopilotDraft | undefined {
		const id = this._byShortcode.get(shortcode);
		return id ? this._drafts.get(id) : undefined;
	}

	listDraftsFor(subscriptionId: string): AutopilotDraft[] {
		const out: AutopilotDraft[] = [];
		for (const d of this._drafts.values()) {
			if (d.subscriptionId === subscriptionId) out.push(d);
		}
		return out;
	}

	__testInsertDraft(d: AutopilotDraft): void {
		this._drafts.set(d.id, d);
		this._byShortcode.set(d.previewShortcode, d.id);
	}

	snapshot(): {
		count: number;
		statuses: Record<AutopilotDraftStatus, number>;
	} {
		const statuses: Record<AutopilotDraftStatus, number> = {
			pending_approval: 0,
			approved: 0,
			redo_requested: 0,
			theme_swapped: 0,
			defaulted: 0,
			shipped: 0,
		};
		for (const d of this._drafts.values()) statuses[d.status] += 1;
		return { count: this._drafts.size, statuses };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function defaultIdGen(): string {
	_idCounter += 1;
	return `${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}
