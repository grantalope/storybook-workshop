// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * ReadAlongBundleBuilder — web bundle for /storybook-workshop/preview/{shortcode}.
 *
 * Spec ref: §3.9 Phase 7. Composes:
 *  - Per-spread static frames (post NameOverlay).
 *  - Per-spread animation manifests (from pretext-book-adapter).
 *  - Voice-over blob (optional).
 *  - Dedication audio blob (optional).
 *  - 8-char base32 shortcode (collision-checked by backend at register time).
 *
 * Email-gate for spread index >4 lives in +server.ts, not in the bundle —
 * bundle ships every spread so the +server.ts can selectively redact.
 */

import type { AnimationManifest, BookAssetBundle, ReadAlongBundle } from './types';

const BASE32_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';   // Crockford-ish, no 0/1/l/o

export function generateShortcode(rng: () => number = Math.random): string {
	let s = '';
	for (let i = 0; i < 8; i++) {
		const r = Math.floor(rng() * BASE32_ALPHABET.length);
		s += BASE32_ALPHABET[r];
	}
	return s;
}

export interface BundleBuildInput {
	bundle: BookAssetBundle;
	resolvedSpreadTexts: string[];
	composedSpreadPngs: Blob[];
	/** Optional collision check — async fn returning `true` when free. */
	isShortcodeFree?: (s: string) => Promise<boolean>;
	rng?: () => number;
}

export interface BundleBuildOutput {
	bundle: ReadAlongBundle;
}

export async function buildReadAlongBundle(input: BundleBuildInput): Promise<BundleBuildOutput> {
	const { bundle, resolvedSpreadTexts, composedSpreadPngs, isShortcodeFree, rng = Math.random } = input;

	// Collision-checked shortcode mint.
	let shortcode = '';
	for (let attempt = 0; attempt < 8; attempt++) {
		shortcode = generateShortcode(rng);
		const free = isShortcodeFree ? await isShortcodeFree(shortcode) : true;
		if (free) break;
		if (attempt === 7) {
			throw new Error('ReadAlongBundleBuilder: failed to mint unique shortcode after 8 attempts');
		}
	}

	const spreads: ReadAlongBundle['spreads'] = composedSpreadPngs.map((framePng, index) => {
		const animation: AnimationManifest = bundle.animationManifests.get(index) ?? {
			beat: 'setup',
			effect: 'flow',
			durationMs: 1500,
			staticFrameIndex: 0
		};
		return {
			index,
			framePng,
			animation,
			text: resolvedSpreadTexts[index] ?? ''
		};
	});

	const out: ReadAlongBundle = {
		shortcode,
		manifest: {
			title: bundle.title,
			spreadCount: spreads.length,
			hasVoiceOver: !!bundle.voiceOver,
			hasDedicationAudio: !!bundle.dedicationAudio
		},
		spreads,
		voiceOver: bundle.voiceOver,
		dedicationAudio: bundle.dedicationAudio
	};
	return { bundle: out };
}
