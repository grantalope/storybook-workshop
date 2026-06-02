// tests/storybook-workshop/subscription/series-theme-registry.test.ts
//
// Covers:
// - exactly 6 series
// - 12 themes each
// - no duplicate themeIds within a series
// - no duplicate series ids
// - getThemeAtSlot wraps modulo for slots > 11
// - getSeries / listSeries / validateRegistryShape

import { describe, it, expect } from 'vitest';
import {
	SERIES_THEMES,
	getSeries,
	getThemeAtSlot,
	listSeries,
	validateRegistryShape,
} from '$lib/services/subscription';

describe('SERIES_THEMES shape', () => {
	it('has exactly 6 series', () => {
		expect(SERIES_THEMES).toHaveLength(6);
	});

	it('every series has 12 themes', () => {
		for (const s of SERIES_THEMES) {
			expect(s.themes).toHaveLength(12);
		}
	});

	it('no duplicate series ids', () => {
		const ids = SERIES_THEMES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('no duplicate themeIds within a series', () => {
		for (const s of SERIES_THEMES) {
			expect(new Set(s.themes).size).toBe(s.themes.length);
		}
	});

	it('validateRegistryShape returns empty errors', () => {
		expect(validateRegistryShape()).toEqual([]);
	});

	it('all 6 spec-named series are present', () => {
		const expectedIds = [
			'series.year-of-adventures',
			'series.big-feelings',
			'series.family-tales',
			'series.first-times',
			'series.seasons-and-holidays',
			'series.friend-of-the-month',
		];
		const actualIds = SERIES_THEMES.map((s) => s.id).sort();
		expect(actualIds).toEqual(expectedIds.sort());
	});
});

describe('getSeries / listSeries', () => {
	it('listSeries returns the same array as SERIES_THEMES', () => {
		expect(listSeries()).toBe(SERIES_THEMES);
	});

	it('getSeries returns series by id', () => {
		const s = getSeries('series.big-feelings');
		expect(s).toBeDefined();
		expect(s!.name).toBe('Big Feelings');
	});

	it('getSeries returns undefined for unknown', () => {
		expect(getSeries('series.nope')).toBeUndefined();
	});
});

describe('getThemeAtSlot', () => {
	it('returns theme at the slot', () => {
		const slot0 = getThemeAtSlot('series.big-feelings', 0);
		expect(slot0).toBeDefined();
	});

	it('wraps modulo 12 for slots > 11', () => {
		const slot0 = getThemeAtSlot('series.big-feelings', 0);
		const slot12 = getThemeAtSlot('series.big-feelings', 12);
		expect(slot12).toBe(slot0);
		const slot13 = getThemeAtSlot('series.big-feelings', 13);
		const slot1 = getThemeAtSlot('series.big-feelings', 1);
		expect(slot13).toBe(slot1);
	});

	it('returns undefined for unknown series', () => {
		expect(getThemeAtSlot('series.nope', 0)).toBeUndefined();
	});

	it('returns undefined for negative slot', () => {
		expect(getThemeAtSlot('series.big-feelings', -1)).toBeUndefined();
	});
});
