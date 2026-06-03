// @graph-layer: private
// @rationale: private (shipping address PII tier)
//
// src/lib/services/fulfillment/ShippingQuoteService.ts
//
// Caches Lulu shipping quotes per (format, pages, country, region). 15 min
// TTL. Includes address validation (minimal: ISO-2 country, postcode non-
// empty, line1+city+region present) — Lulu API rejects malformed addresses
// downstream too, but failing fast keeps the parent UX snappy.
//
// Spec: docs/specs/2026-05-24-design.md §5.2 step 2 + §5.6

import type {
	ShippingAddress,
	ShippingOption,
} from './types';
import { LuluFulfillmentService } from './LuluFulfillmentService';
import type { BookFormat } from '$lib/services/assemble/types';

export class ShippingAddressError extends Error {
	constructor(public readonly field: string, public readonly reason: string) {
		super(`ShippingAddress.${field}: ${reason}`);
		this.name = 'ShippingAddressError';
	}
}

export const SHIPPING_QUOTE_TTL_MS = 15 * 60 * 1000;

/** v1 geo whitelist per spec §5.6 (US + EU + UK + AU + CA + a few common EU members). */
const SUPPORTED_COUNTRIES = new Set<string>([
	'US', 'CA', 'GB', 'AU',
	'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'PT', 'SE', 'FI', 'DK',
	'AT', 'PL', 'CZ', 'GR', 'LU', 'HU', 'RO', 'BG', 'HR', 'SI', 'SK',
	'LT', 'LV', 'EE', 'CY', 'MT',
]);

export function validateShippingAddress(addr: ShippingAddress): void {
	if (!addr.name || addr.name.trim().length < 2) {
		throw new ShippingAddressError('name', 'must be at least 2 characters');
	}
	if (!addr.line1 || addr.line1.trim().length < 3) {
		throw new ShippingAddressError('line1', 'must be at least 3 characters');
	}
	if (!addr.city || addr.city.trim().length < 1) {
		throw new ShippingAddressError('city', 'required');
	}
	if (!addr.region || addr.region.trim().length < 1) {
		throw new ShippingAddressError('region', 'required');
	}
	if (!addr.postcode || addr.postcode.trim().length < 3) {
		throw new ShippingAddressError('postcode', 'must be at least 3 characters');
	}
	if (!addr.country || !/^[A-Z]{2}$/.test(addr.country)) {
		throw new ShippingAddressError('country', 'must be ISO-3166-1 alpha-2');
	}
	if (!SUPPORTED_COUNTRIES.has(addr.country)) {
		throw new ShippingAddressError('country', `not supported in v1 (${addr.country})`);
	}
}

interface CacheEntry {
	at: number;
	options: ShippingOption[];
}

export interface ShippingQuoteOpts {
	lulu: LuluFulfillmentService;
	currency?: string;
	nowSource?: () => number;
	ttlMs?: number;
}

export class ShippingQuoteService {
	private _lulu: LuluFulfillmentService;
	private _currency: string;
	private _now: () => number;
	private _ttl: number;
	private _cache = new Map<string, CacheEntry>();

	constructor(opts: ShippingQuoteOpts) {
		this._lulu = opts.lulu;
		this._currency = opts.currency ?? 'USD';
		this._now = opts.nowSource ?? (() => Date.now());
		this._ttl = opts.ttlMs ?? SHIPPING_QUOTE_TTL_MS;
	}

	private _key(format: BookFormat, pages: number, addr: ShippingAddress): string {
		return `${format}:${pages}:${addr.country}:${addr.region}:${this._currency}`;
	}

	async getQuote(
		address: ShippingAddress,
		format: BookFormat,
		pages: number,
	): Promise<ShippingOption[]> {
		validateShippingAddress(address);
		const key = this._key(format, pages, address);
		const cached = this._cache.get(key);
		const t = this._now();
		if (cached && t - cached.at < this._ttl) {
			return cached.options;
		}
		const options = await this._lulu.getShippingQuote(address, format, pages, this._currency);
		this._cache.set(key, { at: t, options });
		return options;
	}

	/** Test helper — drop cache. */
	_clearCache(): void {
		this._cache.clear();
	}
}
