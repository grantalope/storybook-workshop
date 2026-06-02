// @graph-layer: private
// @rationale: private (content catalog — no PII, but author/theme bindings ship in code)
//
// src/routes/dashboard/services/storybook-workshop/subscription/SeriesThemeRegistry.ts
//
// 6 named themed series, each with exactly 12 themed-content slots in cadence
// order. Bound to the story-author / theme-catalog via opaque `ThemeId`
// strings.
//
// Spec §6.4 named series:
//   1. A Year of Adventures (12 biomes)
//   2. Big Feelings (CASEL-5 emotions)
//   3. Family Tales (family members)
//   4. First Times (milestones)
//   5. Seasons & Holidays (calendar)
//   6. Friend Of The Month (settler rotation)

import type { SeriesTheme, ThemeId } from './types';

// ---------------------------------------------------------------------------
// 6 named series × 12 themes (frozen content catalog)
// ---------------------------------------------------------------------------

/** A Year of Adventures — 12 biomes. */
const A_YEAR_OF_ADVENTURES: ThemeId[] = [
	'biome.forest',
	'biome.beach',
	'biome.mountain',
	'biome.desert',
	'biome.river',
	'biome.meadow',
	'biome.cave',
	'biome.swamp',
	'biome.snow',
	'biome.island',
	'biome.farm',
	'biome.jungle',
];

/** Big Feelings — CASEL-5 + 7 finer-grain emotions. */
const BIG_FEELINGS: ThemeId[] = [
	'feeling.happy',
	'feeling.sad',
	'feeling.angry',
	'feeling.afraid',
	'feeling.surprised',
	'feeling.proud',
	'feeling.lonely',
	'feeling.brave',
	'feeling.curious',
	'feeling.calm',
	'feeling.grateful',
	'feeling.frustrated',
];

/** Family Tales — relations. */
const FAMILY_TALES: ThemeId[] = [
	'family.mom',
	'family.dad',
	'family.sibling',
	'family.grandma',
	'family.grandpa',
	'family.aunt',
	'family.uncle',
	'family.cousin',
	'family.pet',
	'family.baby',
	'family.friend',
	'family.together',
];

/** First Times — milestone events. */
const FIRST_TIMES: ThemeId[] = [
	'first.day-of-school',
	'first.swim',
	'first.haircut',
	'first.sleepover',
	'first.lost-tooth',
	'first.bike',
	'first.dentist',
	'first.cooking',
	'first.trip',
	'first.show-and-tell',
	'first.recital',
	'first.helping',
];

/** Seasons & Holidays — calendar-tied. */
const SEASONS_AND_HOLIDAYS: ThemeId[] = [
	'season.new-year',
	'season.valentines',
	'season.spring',
	'season.summer-solstice',
	'season.beach-summer',
	'season.back-to-school',
	'season.fall',
	'season.halloween',
	'season.harvest',
	'season.winter-snow',
	'season.holiday-lights',
	'season.year-end',
];

/** Friend Of The Month — settler-sidekick rotation. */
const FRIEND_OF_THE_MONTH: ThemeId[] = [
	'friend.bear',
	'friend.fox',
	'friend.rabbit',
	'friend.owl',
	'friend.cat',
	'friend.dog',
	'friend.frog',
	'friend.turtle',
	'friend.dragon',
	'friend.unicorn',
	'friend.robot',
	'friend.alien',
];

export const SERIES_THEMES: readonly SeriesTheme[] = Object.freeze([
	Object.freeze({
		id: 'series.year-of-adventures',
		name: 'A Year of Adventures',
		description: 'Twelve different biomes — a forest hike one month, a beach day the next.',
		themes: Object.freeze([...A_YEAR_OF_ADVENTURES]) as unknown as ThemeId[],
	}),
	Object.freeze({
		id: 'series.big-feelings',
		name: 'Big Feelings',
		description: 'Twelve emotions, one per book. CASEL-aligned social-emotional learning.',
		themes: Object.freeze([...BIG_FEELINGS]) as unknown as ThemeId[],
	}),
	Object.freeze({
		id: 'series.family-tales',
		name: 'Family Tales',
		description: 'Each month features a different family member — mom, dad, grandma, the pet.',
		themes: Object.freeze([...FAMILY_TALES]) as unknown as ThemeId[],
	}),
	Object.freeze({
		id: 'series.first-times',
		name: 'First Times',
		description: 'Milestones: first day of school, first sleepover, first lost tooth.',
		themes: Object.freeze([...FIRST_TIMES]) as unknown as ThemeId[],
	}),
	Object.freeze({
		id: 'series.seasons-and-holidays',
		name: 'Seasons & Holidays',
		description: 'Twelve calendar-tied stories — spring through winter, holiday by holiday.',
		themes: Object.freeze([...SEASONS_AND_HOLIDAYS]) as unknown as ThemeId[],
	}),
	Object.freeze({
		id: 'series.friend-of-the-month',
		name: 'Friend Of The Month',
		description: 'Collect-the-settlers — a new sidekick every book, each with their own arc.',
		themes: Object.freeze([...FRIEND_OF_THE_MONTH]) as unknown as ThemeId[],
	}),
]);

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/** All series. */
export function listSeries(): readonly SeriesTheme[] {
	return SERIES_THEMES;
}

/** Lookup series by id. Returns undefined if not found. */
export function getSeries(seriesId: string): SeriesTheme | undefined {
	return SERIES_THEMES.find((s) => s.id === seriesId);
}

/**
 * Get the themeId at slot N (0-indexed) within a series. Wraps via modulo if
 * the subscription exceeds 12 books — series repeats once it's run through.
 */
export function getThemeAtSlot(seriesId: string, slot: number): ThemeId | undefined {
	const series = getSeries(seriesId);
	if (!series) return undefined;
	if (slot < 0) return undefined;
	return series.themes[slot % series.themes.length];
}

/**
 * Sanity check helper used by tests — assert series shape invariants.
 * Returns the list of errors found (empty when shape is valid).
 */
export function validateRegistryShape(): string[] {
	const errors: string[] = [];
	if (SERIES_THEMES.length !== 6) {
		errors.push(`expected 6 series, got ${SERIES_THEMES.length}`);
	}
	const ids = new Set<string>();
	for (const s of SERIES_THEMES) {
		if (ids.has(s.id)) errors.push(`duplicate series id ${s.id}`);
		ids.add(s.id);
		if (s.themes.length !== 12) {
			errors.push(`series ${s.id}: expected 12 themes, got ${s.themes.length}`);
		}
		const themeIds = new Set<ThemeId>();
		for (const t of s.themes) {
			if (themeIds.has(t)) errors.push(`series ${s.id}: duplicate theme ${t}`);
			themeIds.add(t);
		}
	}
	return errors;
}
