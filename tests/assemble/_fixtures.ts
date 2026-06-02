/**
 * Shared fixtures for storybook-workshop/assemble tests.
 *
 * Real PNG bytes are required by pdf-lib's embedPng — we ship a 2×2 PNG
 * constant + a small helper that wraps it in a Blob. Bundles produced here
 * are minimum-viable; tests override specific fields as needed.
 */
import type { AnimationManifest, BookAssetBundle } from '$lib/services/assemble/types';

// 2×2 transparent PNG (raw bytes — valid, embeddable by pdf-lib).
const TINY_PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
	0x24, 0x00, 0x00, 0x00, 0x16, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82
]);

export function tinyPng(): Blob {
	return new Blob([TINY_PNG_BYTES], { type: 'image/png' });
}

export function makeBundle(overrides: Partial<BookAssetBundle> = {}): BookAssetBundle {
	const wb = new Map<string, Blob[]>();
	wb.set('scene-1', [tinyPng()]);
	wb.set('scene-2', [tinyPng()]);
	wb.set('scene-3', [tinyPng()]);
	wb.set('scene-4', [tinyPng()]);
	wb.set('scene-5', [tinyPng()]);
	wb.set('scene-6', [tinyPng()]);
	wb.set('scene-7', [tinyPng()]);
	const pretextFrames = new Map<number, Blob>();
	const animationManifests = new Map<number, AnimationManifest>();
	for (let i = 0; i < 7; i++) {
		pretextFrames.set(i, tinyPng());
		animationManifests.set(i, {
			beat: (['setup','catalyst','debate','midpoint','trial','climax','resolution'] as const)[i],
			effect: (['flow','bounce-in','wave','magnetic','glitch','vortex','rise'] as const)[i],
			durationMs: 1500,
			staticFrameIndex: 0
		});
	}
	return {
		wbPngsByScene: wb,
		pretextStaticFrames: pretextFrames,
		animationManifests,
		kidName: 'Eli',
		dedication: 'For my brave reader.',
		sidekickSettlerInfo: { settlerId: 'ada-7f3', displayName: 'Ada' },
		title: 'The Brave Reader',
		backCoverBlurb: 'A story about courage.',
		format: 'hardcover-8x8',
		pages: 24,
		...overrides
	};
}
