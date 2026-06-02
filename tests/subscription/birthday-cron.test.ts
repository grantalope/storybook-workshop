// tests/storybook-workshop/subscription/birthday-cron.test.ts
//
// Covers:
// - 6-week-pre fire (clock-driven)
// - idempotency on (kidId, year) — re-running tick same day doesn't double-fire
// - opted-out kids skipped
// - grandparent registered → both emails fire
// - registerKid validation

import { describe, it, expect, beforeEach } from 'vitest';
import { BirthdayCronService } from '$lib/services/subscription';
import { createMockMailer, makeClock } from './fixtures';

const ONE_DAY = 24 * 60 * 60 * 1000;

/** Pick a "today" timestamp and compute a birthday exactly N days away. */
function bdayInDays(today: number, days: number): { month: number; day: number } {
	const target = new Date(today + days * ONE_DAY);
	return {
		month: target.getUTCMonth() + 1,
		day: target.getUTCDate(),
	};
}

describe('BirthdayCronService.registerKid', () => {
	let mailer: ReturnType<typeof createMockMailer>;
	let svc: BirthdayCronService;

	beforeEach(() => {
		mailer = createMockMailer();
		svc = new BirthdayCronService({
			mailer,
			nowSource: () => 1_700_000_000_000,
		});
	});

	it('rejects invalid month', () => {
		expect(() =>
			svc.registerKid({
				kidId: 'kid-1',
				parentEmail: 'parent@example.com',
				birthdayMonth: 13,
				birthdayDay: 1,
				kidName: 'Eli',
				optedIn: true,
			})
		).toThrow(/invalid birthdayMonth/);
	});

	it('rejects invalid day', () => {
		expect(() =>
			svc.registerKid({
				kidId: 'kid-1',
				parentEmail: 'parent@example.com',
				birthdayMonth: 6,
				birthdayDay: 32,
				kidName: 'Eli',
				optedIn: true,
			})
		).toThrow(/invalid birthdayDay/);
	});

	it('rejects empty kidId', () => {
		expect(() =>
			svc.registerKid({
				kidId: '',
				parentEmail: 'parent@example.com',
				birthdayMonth: 6,
				birthdayDay: 15,
				kidName: 'Eli',
				optedIn: true,
			})
		).toThrow(/kidId required/);
	});
});

describe('BirthdayCronService.tick', () => {
	let mailer: ReturnType<typeof createMockMailer>;
	let svc: BirthdayCronService;
	let clock: ReturnType<typeof makeClock>;
	const T_TODAY = Date.UTC(2026, 0, 15); // 2026-01-15

	beforeEach(() => {
		mailer = createMockMailer();
		clock = makeClock(T_TODAY);
		svc = new BirthdayCronService({
			mailer,
			nowSource: clock.now,
		});
	});

	it('fires email when birthday is exactly 42 days out', async () => {
		const target = bdayInDays(T_TODAY, 42);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: true,
		});
		const result = await svc.tick();
		expect(result.emailsSent).toBe(1);
		expect(mailer.calls.find((c) => c.kind === 'birthday_six_weeks_pre')).toBeDefined();
	});

	it('does not fire when birthday is 30 days away', async () => {
		const target = bdayInDays(T_TODAY, 30);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: true,
		});
		const result = await svc.tick();
		expect(result.emailsSent).toBe(0);
	});

	it('does not fire when birthday is 60 days away', async () => {
		const target = bdayInDays(T_TODAY, 60);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: true,
		});
		const result = await svc.tick();
		expect(result.emailsSent).toBe(0);
	});

	it('idempotent — re-running tick the same day does NOT re-fire', async () => {
		const target = bdayInDays(T_TODAY, 42);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: true,
		});
		const first = await svc.tick();
		expect(first.emailsSent).toBe(1);
		const second = await svc.tick();
		expect(second.emailsSent).toBe(0);
		expect(second.skippedAsIdempotent).toBe(1);
	});

	it('skips opted-out kids', async () => {
		const target = bdayInDays(T_TODAY, 42);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: false,
		});
		const result = await svc.tick();
		expect(result.notOptedIn).toBe(1);
		expect(result.emailsSent).toBe(0);
	});

	it('grandparent + parent both receive when registered', async () => {
		const target = bdayInDays(T_TODAY, 42);
		svc.registerKid({
			kidId: 'kid-1',
			parentEmail: 'parent@example.com',
			grandparentEmail: 'grandma@example.com',
			birthdayMonth: target.month,
			birthdayDay: target.day,
			kidName: 'Eli',
			optedIn: true,
		});
		const result = await svc.tick();
		expect(result.emailsSent).toBe(2);
		const recipients = mailer.calls
			.filter((c) => c.kind === 'birthday_six_weeks_pre')
			.map((c) => c.to)
			.sort();
		expect(recipients).toEqual(['grandma@example.com', 'parent@example.com']);
	});
});
