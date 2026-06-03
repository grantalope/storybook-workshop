import { describe, expect, it } from 'vitest';
import {
	AbandonedCartService,
	MockCrmClient,
	PromoCodeService,
} from '$lib/services/marketing';

describe('AbandonedCartService', () => {
	function setup() {
		let now = 0;
		const crm = new MockCrmClient(() => now);
		const promo = new PromoCodeService({ nowSource: () => now });
		const svc = new AbandonedCartService({
			crm,
			promo,
			nowSource: () => now,
			publicUrlBase: 'https://sw.example',
		});
		return {
			svc,
			crm,
			promo,
			get now() {
				return now;
			},
			set now(v: number) {
				now = v;
			},
			setNow(v: number) {
				now = v;
			},
		};
	}

	it('tracks a fresh cart', () => {
		const ctx = setup();
		const cart = ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'kid1',
			bookId: 'book1',
			bookCostCents: 3499,
		});
		expect(cart.resolved).toBe(false);
		expect(cart.bookCostCents).toBe(3499);
	});

	it('does not spam re-tracking within 5 minutes (idempotent reset)', () => {
		const ctx = setup();
		const a = ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'kid1',
			bookId: 'book1',
			bookCostCents: 3499,
		});
		ctx.setNow(2 * 60 * 1000);
		const b = ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'kid1',
			bookId: 'book1',
			bookCostCents: 3499,
		});
		expect(b.abandonedAt).toBe(a.abandonedAt);
	});

	it('escalates promos: 5% -> 10% -> 15%', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		ctx.setNow(24 * 60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		ctx.setNow(72 * 60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		const pcts = ctx.crm.sent.map((s) => Number(s.vars.pct_off));
		expect(pcts).toEqual([5, 10, 15]);
	});

	it('sends to the correct template at each stop', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(72 * 60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		expect(ctx.crm.sentByTemplate('abandoned_cart_T1h')).toHaveLength(1);
		expect(ctx.crm.sentByTemplate('abandoned_cart_T24h')).toHaveLength(1);
		expect(ctx.crm.sentByTemplate('abandoned_cart_T72h')).toHaveLength(1);
	});

	it('stops sending once cart is resolved', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		ctx.svc.resolve('p@example.com', 'k');
		ctx.setNow(24 * 60 * 60 * 1000 + 1);
		const r = await ctx.svc.tick();
		expect(r.skippedResolved).toBe(1);
		expect(r.sent).toBe(0);
	});

	it('does not re-send a stop the cart already received', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		await ctx.svc.tick();
		expect(ctx.crm.sentByTemplate('abandoned_cart_T1h')).toHaveLength(1);
	});

	it('mints a unique promo per stop', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(72 * 60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		const codes = ctx.svc.mintedPromos().map((p) => p.code);
		expect(new Set(codes).size).toBe(3);
		expect(codes.every((c) => c.length === 10)).toBe(true);
	});

	it('different kids get independent recovery chains', async () => {
		const ctx = setup();
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'kid1',
			bookId: 'b1',
			bookCostCents: 3499,
		});
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'kid2',
			bookId: 'b2',
			bookCostCents: 3499,
		});
		ctx.setNow(60 * 60 * 1000 + 1);
		await ctx.svc.tick();
		expect(ctx.crm.sentByTemplate('abandoned_cart_T1h')).toHaveLength(2);
	});

	it('counts failures separately from sends', async () => {
		const ctx = setup();
		ctx.crm.forcedError = 'network down';
		ctx.svc.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			bookId: 'b',
			bookCostCents: 3499,
		});
		ctx.setNow(60 * 60 * 1000 + 1);
		const r = await ctx.svc.tick();
		expect(r.failed).toBe(1);
		expect(r.sent).toBe(0);
	});
});
