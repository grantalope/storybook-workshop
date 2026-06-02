// @graph-layer: private
// @rationale: private (kid birthday + parent + grandparent emails are PII)
//
// src/routes/dashboard/services/storybook-workshop/subscription/BirthdayCronService.ts
//
// 6-week-pre-birthday email auto-fires to parent + any registered
// grandparent. Idempotency key `(kidId, year)`.
//
// Spec §8.5. Triggered by external cron (system cron or cloud scheduler)
// once per day via POST /api/birthday-cron — never
// in-app polled (server-only).

import type {
	BirthdayCronTickResult,
	KidBirthdayProfile,
	MailerProvider,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Window opens 6 weeks pre-birthday — fire once per (kidId, year). */
export const BIRTHDAY_LEAD_DAYS = 42;
/** Lookahead band — we fire when birthday is between `BIRTHDAY_LEAD_DAYS - 0` and `BIRTHDAY_LEAD_DAYS + 1` days out. */
export const BIRTHDAY_FIRE_BAND_DAYS = 1;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BirthdayCronServiceOpts {
	mailer: MailerProvider;
	nowSource?: () => number;
}

export class BirthdayCronService {
	private _profiles = new Map<string, KidBirthdayProfile>();
	/** Set of (kidId|year) keys we've already fired for. Idempotency. */
	private _firedKeys = new Set<string>();
	private _mailer: MailerProvider;
	private _now: () => number;

	constructor(opts: BirthdayCronServiceOpts) {
		this._mailer = opts.mailer;
		this._now = opts.nowSource ?? (() => Date.now());
	}

	/** Register / update a kid's birthday profile. */
	registerKid(p: KidBirthdayProfile): void {
		if (!p.kidId) throw new Error(`BirthdayCronService: kidId required`);
		if (p.birthdayMonth < 1 || p.birthdayMonth > 12) {
			throw new Error(`BirthdayCronService: invalid birthdayMonth ${p.birthdayMonth}`);
		}
		if (p.birthdayDay < 1 || p.birthdayDay > 31) {
			throw new Error(`BirthdayCronService: invalid birthdayDay ${p.birthdayDay}`);
		}
		this._profiles.set(p.kidId, p);
	}

	getKid(kidId: string): KidBirthdayProfile | undefined {
		return this._profiles.get(kidId);
	}

	/** Tick — invoked by the external cron once per day. */
	async tick(): Promise<BirthdayCronTickResult> {
		const result: BirthdayCronTickResult = {
			processed: 0,
			emailsSent: 0,
			skippedAsIdempotent: 0,
			notOptedIn: 0,
		};
		const now = new Date(this._now());

		for (const profile of this._profiles.values()) {
			result.processed += 1;
			if (!profile.optedIn) {
				result.notOptedIn += 1;
				continue;
			}
			const upcomingBirthday = this._upcomingBirthday(
				now,
				profile.birthdayMonth,
				profile.birthdayDay
			);
			const daysUntil = this._daysBetween(now, upcomingBirthday);
			if (
				daysUntil < BIRTHDAY_LEAD_DAYS ||
				daysUntil > BIRTHDAY_LEAD_DAYS + BIRTHDAY_FIRE_BAND_DAYS
			) {
				continue;
			}
			// Idempotency key — (kidId|targetYear) where targetYear is the
			// birthday year we're firing for.
			const key = `${profile.kidId}|${upcomingBirthday.getFullYear()}`;
			if (this._firedKeys.has(key)) {
				result.skippedAsIdempotent += 1;
				continue;
			}
			this._firedKeys.add(key);

			await this._mailer.send({
				to: profile.parentEmail,
				kind: 'birthday_six_weeks_pre',
				variables: {
					kidName: profile.kidName,
					daysUntil: String(daysUntil),
				},
			});
			result.emailsSent += 1;

			if (profile.grandparentEmail) {
				await this._mailer.send({
					to: profile.grandparentEmail,
					kind: 'birthday_six_weeks_pre',
					variables: {
						kidName: profile.kidName,
						daysUntil: String(daysUntil),
					},
				});
				result.emailsSent += 1;
			}
		}
		return result;
	}

	/**
	 * Find the next occurrence of (month, day) on or after `from`. Note:
	 * Feb 29 + non-leap = Mar 1 (next valid day downgrade).
	 */
	private _upcomingBirthday(from: Date, month: number, day: number): Date {
		const year = from.getUTCFullYear();
		const thisYear = new Date(Date.UTC(year, month - 1, day));
		if (thisYear.getUTCMonth() !== month - 1) {
			// rolled over — use March 1
			thisYear.setUTCMonth(2, 1);
		}
		if (thisYear.getTime() >= from.getTime()) return thisYear;
		const nextYear = new Date(Date.UTC(year + 1, month - 1, day));
		if (nextYear.getUTCMonth() !== month - 1) {
			nextYear.setUTCMonth(2, 1);
		}
		return nextYear;
	}

	private _daysBetween(from: Date, to: Date): number {
		const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
		const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
		return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
	}

	__testClearFiredKeys(): void {
		this._firedKeys.clear();
	}

	__testGetFiredKeys(): string[] {
		return Array.from(this._firedKeys);
	}

	snapshot(): { profiles: number; firedKeys: number } {
		return { profiles: this._profiles.size, firedKeys: this._firedKeys.size };
	}
}
