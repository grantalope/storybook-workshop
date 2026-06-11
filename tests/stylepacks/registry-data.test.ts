import { describe, expect, it } from 'vitest';
import { listStylePacks, validateStylePack } from '$lib/services/stylepacks';

const EXPECTED_IDS = [
	'octopath-hd2d',
	'flat-painted',
	'pixel-pure',
	'ukiyo-e-woodblock',
	'impressionist-garden',
	'post-impressionist-swirl',
	'cutout-collage',
	'watercolor-botanical',
	'stained-glass',
	'illuminated-manuscript',
	'persian-miniature',
	'mexican-amate-folk',
	'scandinavian-rosemaling',
	'art-nouveau-poster',
	'bauhaus-geometric',
];

describe('StylePackRegistry data', () => {
	it('lists exactly 3 legacy packs followed by 12 art-history packs', () => {
		expect(listStylePacks().map((pack) => pack.id)).toEqual(EXPECTED_IDS);
	});

	it('validates every non-legacy pack against the 2026 public-domain guard', () => {
		for (const pack of listStylePacks().filter((p) => !p.legacy)) {
			expect(() => validateStylePack(pack, 2026), pack.id).not.toThrow();
		}
	});

	it('ships non-empty educational cards in a short kid-facing voice', () => {
		for (const pack of listStylePacks().filter((p) => !p.legacy)) {
			expect(pack.educationalCard, pack.id).toBeDefined();
			for (const field of [
				'kidExplainer',
				'funFact',
				'lookFor',
				'tryItYourself',
				'famousWorkDescription',
			] as const) {
				expect(pack.educationalCard?.[field]?.trim(), `${pack.id}.${field}`).toBeTruthy();
			}
			expect(pack.educationalCard!.kidExplainer.length, pack.id).toBeLessThanOrEqual(400);
		}
	});

	it('uses valid 4-6 color hex palettes', () => {
		for (const pack of listStylePacks().filter((p) => !p.legacy)) {
			expect(pack.promptRecipe?.palette.length, pack.id).toBeGreaterThanOrEqual(4);
			expect(pack.promptRecipe?.palette.length, pack.id).toBeLessThanOrEqual(6);
			for (const color of pack.promptRecipe!.palette) {
				expect(color, `${pack.id} ${color}`).toMatch(/^#[0-9a-f]{6}$/i);
			}
		}
	});

	it('keeps named shipping inspirations at or before the pre-1955 boundary', () => {
		for (const pack of listStylePacks().filter((p) => !p.legacy)) {
			for (const inspiration of pack.inspirations) {
				expect(inspiration.died, `${pack.id} ${inspiration.name}`).toBeLessThanOrEqual(1955);
			}
		}
	});
});
