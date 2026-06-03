// Trusted server-side pricing table per spec §6.1.
//
// SECURITY: this module is the SINGLE source of truth for what a parent pays
// per book. The order-create endpoint MUST compute `bookCostCents` via
// `priceForBook(format, pages)` and IGNORE any client-supplied amount.
// Accepting client-supplied pricing was flagged as a CRITICAL price-tampering
// vulnerability in the 2026-06-03 security review.
//
// Per spec §6.1 the retail tiers are:
//   Bedtime (~16pp saddle-stitch)        — $14.99
//   Standard (~24pp softcover)            — $19.99
//   Standard (~24pp hardcover) [flagship] — $29.99
//   Adventure (~32pp softcover)           — $22.99
//   Adventure (~32pp hardcover)           — $34.99
//   Saga (~48pp softcover)                — $26.99
//   Saga (~48pp hardcover)                — $44.99
//
// Page-count tiers (interpolation between tier breakpoints uses NEXT tier):
//   pages <=20  → bedtime tier
//   pages <=28  → standard tier
//   pages <=40  → adventure tier
//   pages >40   → saga tier
//
// Each tier × format has a fixed price (no per-page interpolation in MVP).
// Future: granular per-page pricing via a Lulu live-pricing fetch + margin
// rules. Tracked in implementation-notes.md as a v2 follow-up.

import type { BookFormat } from "$lib/services/assemble/types";

export type PriceTier = "bedtime" | "standard" | "adventure" | "saga";

export interface PriceTierResolution {
	readonly tier: PriceTier;
	readonly format: BookFormat;
	readonly priceCents: number;
}

/** Map page count → length tier. */
export function tierForPages(pages: number): PriceTier {
	if (!Number.isFinite(pages) || pages < 4) {
		throw new Error(`tierForPages: pages must be >= 4, got ${pages}`);
	}
	if (pages <= 20) return "bedtime";
	if (pages <= 28) return "standard";
	if (pages <= 40) return "adventure";
	return "saga";
}

// Format × tier → cents. Saddle-stitch is bedtime-only; hardcover supports
// standard/adventure/saga; softcover supports all 4. Unsupported combos throw.
const PRICE_TABLE: Record<BookFormat, Partial<Record<PriceTier, number>>> = Object.freeze({
	"saddlestitch-8x8": {
		bedtime: 1499,
		// saddlestitch tops out at 48pp per FORMAT_SPECS.maxPages — allow
		// standard tier too as a fallback when parent picks 24-28pp saddle.
		standard: 1799,
	},
	"softcover-8x8": {
		// softcover-8x8 minPages is 32; pages <32 are invalid at the
		// upstream FORMAT_SPECS check (pages_out_of_range). bedtime + standard
		// entries here are defensive — if FORMAT_SPECS ever opens up, the
		// price still resolves predictably.
		bedtime: 1499,
		standard: 1999,
		adventure: 2299,
		saga: 2699,
	},
	"hardcover-8x8": {
		// hardcover-8x8 minPages is 24; bedtime tier here is defensive only.
		bedtime: 2499,
		standard: 2999,
		adventure: 3499,
		saga: 4499,
	},
});

/**
 * Returns the cents amount a parent pays for a book of the given format +
 * page count. Throws on unknown format or unsupported (format, tier) combo.
 *
 * Server-only — never call from client code, never trust a client-supplied
 * "expected" price. Use `verifyClientPriceClaim` if you need a sanity-check
 * that the client UI surfaced the right amount before checkout.
 */
export function priceForBook(format: BookFormat, pages: number): number {
	const tier = tierForPages(pages);
	const formatPrices = PRICE_TABLE[format];
	if (!formatPrices) {
		throw new Error(`priceForBook: unknown format "${format}"`);
	}
	const priceCents = formatPrices[tier];
	if (priceCents === undefined) {
		throw new Error(
			`priceForBook: format "${format}" does not support tier "${tier}" (pages=${pages})`,
		);
	}
	return priceCents;
}

/** Resolve full pricing context (tier + format + cents). */
export function resolveBookPrice(format: BookFormat, pages: number): PriceTierResolution {
	return { tier: tierForPages(pages), format, priceCents: priceForBook(format, pages) };
}

/**
 * Optional client-vs-server price reconciliation. Returns null if the client
 * did not supply a price claim (acceptable in MVP — server is authoritative).
 * Returns an error message string if the client claim disagrees with the
 * server-computed price (UI bug or tampering attempt — caller should 400).
 */
export function verifyClientPriceClaim(
	clientCents: number | undefined | null,
	serverCents: number,
): string | null {
	if (clientCents === undefined || clientCents === null) return null;
	if (typeof clientCents !== "number" || !Number.isFinite(clientCents)) {
		return "client_price_not_a_number";
	}
	if (Math.round(clientCents) !== serverCents) {
		return `client_price_mismatch: client=${clientCents} server=${serverCents}`;
	}
	return null;
}
