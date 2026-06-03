/**
 * Pricing — trusted server-side price table.
 *
 * Verifies the security contract: every (format, pages) input resolves to
 * exactly one server-determined price; client-supplied amounts are not
 * trusted. The companion order endpoint test (`api-order-endpoint.test.ts`)
 * verifies tampering attempts are rejected end-to-end.
 */
import { describe, it, expect } from "vitest";
import { priceForBook, resolveBookPrice, tierForPages, verifyClientPriceClaim } from "$lib/services/fulfillment/pricing";

describe("tierForPages", () => {
	it("maps page counts to tiers per spec §6.1", () => {
		expect(tierForPages(16)).toBe("bedtime");
		expect(tierForPages(20)).toBe("bedtime");
		expect(tierForPages(21)).toBe("standard");
		expect(tierForPages(24)).toBe("standard");
		expect(tierForPages(28)).toBe("standard");
		expect(tierForPages(29)).toBe("adventure");
		expect(tierForPages(32)).toBe("adventure");
		expect(tierForPages(40)).toBe("adventure");
		expect(tierForPages(41)).toBe("saga");
		expect(tierForPages(48)).toBe("saga");
		expect(tierForPages(100)).toBe("saga");
	});

	it("throws on non-positive / non-finite pages", () => {
		expect(() => tierForPages(0)).toThrow();
		expect(() => tierForPages(-1)).toThrow();
		expect(() => tierForPages(Number.NaN)).toThrow();
		expect(() => tierForPages(Number.POSITIVE_INFINITY)).toThrow();
		// Allow the lower bound (4 = saddle-stitch minimum)
		expect(tierForPages(4)).toBe("bedtime");
	});
});

describe("priceForBook (flagship tier × format prices per spec §6.1)", () => {
	it("hardcover-8x8 standard 24pp = $29.99 (flagship)", () => {
		expect(priceForBook("hardcover-8x8", 24)).toBe(2999);
	});

	it("hardcover-8x8 adventure 32pp = $34.99", () => {
		expect(priceForBook("hardcover-8x8", 32)).toBe(3499);
	});

	it("hardcover-8x8 saga 48pp = $44.99", () => {
		expect(priceForBook("hardcover-8x8", 48)).toBe(4499);
	});

	it("softcover-8x8 standard 24pp = $19.99", () => {
		expect(priceForBook("softcover-8x8", 24)).toBe(1999);
	});

	it("softcover-8x8 adventure 32pp = $22.99", () => {
		expect(priceForBook("softcover-8x8", 32)).toBe(2299);
	});

	it("softcover-8x8 saga 48pp = $26.99", () => {
		expect(priceForBook("softcover-8x8", 48)).toBe(2699);
	});

	it("saddlestitch-8x8 bedtime 16pp = $14.99", () => {
		expect(priceForBook("saddlestitch-8x8", 16)).toBe(1499);
	});

	it("rejects saddlestitch in adventure tier (no entry in price table)", () => {
		expect(() => priceForBook("saddlestitch-8x8", 32)).toThrow(/does not support tier "adventure"/);
	});

	it("rejects saddlestitch in saga tier", () => {
		expect(() => priceForBook("saddlestitch-8x8", 48)).toThrow(/does not support tier "saga"/);
	});

	it("throws on unknown format", () => {
		expect(() => priceForBook("loose-leaf" as unknown as Parameters<typeof priceForBook>[0], 24)).toThrow(/unknown format/);
	});
});

describe("resolveBookPrice", () => {
	it("returns tier + format + cents in one call", () => {
		const r = resolveBookPrice("hardcover-8x8", 24);
		expect(r).toEqual({ tier: "standard", format: "hardcover-8x8", priceCents: 2999 });
	});
});

describe("verifyClientPriceClaim (sanity-check, not authoritative)", () => {
	it("returns null when client supplied no price (acceptable; server is authoritative)", () => {
		expect(verifyClientPriceClaim(undefined, 2999)).toBe(null);
		expect(verifyClientPriceClaim(null, 2999)).toBe(null);
	});

	it("returns null when client price matches server price", () => {
		expect(verifyClientPriceClaim(2999, 2999)).toBe(null);
	});

	it("returns error string when client tries to undercut", () => {
		expect(verifyClientPriceClaim(50, 2999)).toMatch(/client_price_mismatch/);
		expect(verifyClientPriceClaim(50, 2999)).toMatch(/client=50/);
		expect(verifyClientPriceClaim(50, 2999)).toMatch(/server=2999/);
	});

	it("returns error string when client tries to overcharge themselves (still a mismatch)", () => {
		expect(verifyClientPriceClaim(99999, 2999)).toMatch(/client_price_mismatch/);
	});

	it("rejects non-numeric client prices", () => {
		expect(verifyClientPriceClaim("free" as unknown as number, 2999)).toBe("client_price_not_a_number");
		expect(verifyClientPriceClaim(Number.NaN, 2999)).toBe("client_price_not_a_number");
		expect(verifyClientPriceClaim(Number.POSITIVE_INFINITY, 2999)).toBe("client_price_not_a_number");
	});
});
