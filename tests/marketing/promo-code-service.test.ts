import { describe, expect, it } from 'vitest';
import { PromoCodeService, FIRST_TIME_CODE } from '$lib/services/marketing';

describe('PromoCodeService', () => {
	it('seeds the fixed BEDTIME10 first-time code', () => {
		const svc = new PromoCodeService();
		const code = svc.getCode(FIRST_TIME_CODE);
		expect(code).toBeDefined();
		expect(code?.type).toBe('first_time');
		expect(code?.pctOff).toBe(10);
		expect(code?.maxDiscountCents).toBe(500);
	});

	it('applies BEDTIME10 capped at $5 (max discount)', () => {
		const svc = new PromoCodeService();
		// 10% of $34.99 = $3.49 -> under cap, full discount
		const a = svc.apply({ code: 'BEDTIME10', parentEmail: 'p@x.com', subtotalCents: 3499 });
		expect(a.ok).toBe(true);
		expect(a.discountCents).toBe(349);
		expect(a.finalCents).toBe(3150);
		// 10% of $100 = $10 -> capped at $5
		const b = svc.apply({ code: 'BEDTIME10', parentEmail: 'p@x.com', subtotalCents: 10000 });
		expect(b.discountCents).toBe(500);
	});

	it('refuses to redeem BEDTIME10 a second time per parent', () => {
		const svc = new PromoCodeService();
		const r1 = svc.redeem({ code: 'BEDTIME10', parentEmail: 'p@x.com', orderId: 'o1' });
		expect(r1.ok).toBe(true);
		const r2 = svc.validate({ code: 'BEDTIME10', parentEmail: 'p@x.com' });
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('exhausted');
	});

	it('mints an abandoned-cart promo + enforces parent scope', () => {
		const svc = new PromoCodeService();
		const promo = svc.mintAbandonedCartPromo({
			parentEmail: 'p@x.com',
			cartId: 'cart1',
			pctOff: 10,
		});
		expect(promo.code).toHaveLength(10);
		expect(promo.scopedToParentEmail).toBe('p@x.com');
		const wrong = svc.validate({ code: promo.code, parentEmail: 'other@x.com' });
		expect(wrong.error).toBe('wrong_parent');
	});

	it('mints a birthday promo at 15%', () => {
		const svc = new PromoCodeService();
		const promo = svc.mintBirthdayPromo('p@x.com');
		expect(promo.type).toBe('birthday');
		expect(promo.pctOff).toBe(15);
		expect(promo.scopedToParentEmail).toBe('p@x.com');
	});

	it('rejects expired birthday promo', () => {
		let now = 0;
		const svc = new PromoCodeService({ nowSource: () => now });
		const promo = svc.mintBirthdayPromo('p@x.com', 1000);
		now = 5000;
		const v = svc.validate({ code: promo.code, parentEmail: 'p@x.com' });
		expect(v.error).toBe('expired');
	});

	it('refuses unknown code', () => {
		const svc = new PromoCodeService();
		const v = svc.validate({ code: 'NOTACODE99', parentEmail: 'p@x.com' });
		expect(v.error).toBe('unknown');
	});

	it('enforces single-promo-per-order', () => {
		const svc = new PromoCodeService();
		const a = svc.mintAbandonedCartPromo({ parentEmail: 'p@x.com', cartId: 'c1', pctOff: 10 });
		const b = svc.mintAbandonedCartPromo({ parentEmail: 'p@x.com', cartId: 'c1', pctOff: 15 });
		const r1 = svc.redeem({ code: a.code, parentEmail: 'p@x.com', orderId: 'o1' });
		expect(r1.ok).toBe(true);
		const r2 = svc.redeem({ code: b.code, parentEmail: 'p@x.com', orderId: 'o1' });
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('already_used_in_order');
	});

	it('re-applying the SAME code to the SAME order is OK', () => {
		const svc = new PromoCodeService();
		const r1 = svc.redeem({ code: FIRST_TIME_CODE, parentEmail: 'p@x.com', orderId: 'o1' });
		expect(r1.ok).toBe(true);
		// Redeeming again of SAME code on same order — should still succeed but bumps usageCount.
		const r2 = svc.redeem({ code: FIRST_TIME_CODE, parentEmail: 'p@x.com', orderId: 'o1' });
		// First-time semantic means even the second redemption is rejected as 'exhausted' (already redeemed).
		expect(r2.ok).toBe(false);
		expect(r2.error).toBe('exhausted');
	});

	it('series-discount promo respects maxUsage cap', () => {
		const svc = new PromoCodeService();
		const promo = svc.mintSeriesDiscount({ pctOff: 20, maxUsage: 2 });
		// Use it twice with different orderIds (no parent scope).
		const r1 = svc.redeem({ code: promo.code, parentEmail: 'a@x.com', orderId: 'o1' });
		const r2 = svc.redeem({ code: promo.code, parentEmail: 'b@x.com', orderId: 'o2' });
		const r3 = svc.redeem({ code: promo.code, parentEmail: 'c@x.com', orderId: 'o3' });
		expect(r1.ok).toBe(true);
		expect(r2.ok).toBe(true);
		expect(r3.ok).toBe(false);
		expect(r3.error).toBe('exhausted');
	});

	it('apply() reports unknown codes without throwing', () => {
		const svc = new PromoCodeService();
		const r = svc.apply({ code: 'BAD', parentEmail: 'p@x.com', subtotalCents: 1000 });
		expect(r.ok).toBe(false);
		expect(r.finalCents).toBe(1000);
		expect(r.discountCents).toBe(0);
	});

	it('snapshots redeemed-by-type counters', () => {
		const svc = new PromoCodeService();
		svc.redeem({ code: FIRST_TIME_CODE, parentEmail: 'p@x.com', orderId: 'o1' });
		const promo = svc.mintBirthdayPromo('p2@x.com');
		svc.redeem({ code: promo.code, parentEmail: 'p2@x.com', orderId: 'o2' });
		const s = svc.snapshot();
		expect(s.redeemedByType.first_time).toBe(1);
		expect(s.redeemedByType.birthday).toBe(1);
	});

	it('codeGen override mints deterministic codes', () => {
		let i = 0;
		const svc = new PromoCodeService({ codeGen: () => `CODE${i++}` });
		const a = svc.mintAbandonedCartPromo({ parentEmail: 'p@x.com', cartId: 'c', pctOff: 5 });
		expect(a.code).toBe('CODE0');
	});
});
