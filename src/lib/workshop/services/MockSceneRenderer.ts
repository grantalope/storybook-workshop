// @graph-layer: private
// @rationale: private (placeholder render path until HD-2D adapter ships)

// src/lib/workshop/services/MockSceneRenderer.ts
//
// MVP placeholder: real Real3dHd2dScene + StorybookSceneRenderer ships in
// goal #12 hd2d-renderer-adapter. Until then, this returns a deterministic
// 1×1 PNG Blob per scene so the rest of the pipeline (BookSpreadSurfaceAdapter
// + BookAssembler) can exercise end-to-end.

import type { SceneTree } from '$lib/services/author/types';
import type { ArtStyle } from '$lib/workshop/types';

// 1×1 transparent PNG, base64 encoded
const ONE_PX_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function decodeBase64ToUint8(b64: string): Uint8Array {
	const binStr = atob(b64);
	const out = new Uint8Array(binStr.length);
	for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i);
	return out;
}

export async function mockRenderScenePng(_opts?: {
	sceneId: string;
	artStyle: ArtStyle;
}): Promise<Blob> {
	const bytes = decodeBase64ToUint8(ONE_PX_PNG_B64);
	return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
}

export interface MockSceneRenderResult {
	wbPngsByScene: Map<string, Blob[]>;
}

/**
 * For each scene in the tree, render `spread_count` placeholder PNGs.
 * Returns the wbPngsByScene Map that BookAssetBundle expects.
 */
export async function mockRenderAllScenes(
	tree: SceneTree,
	artStyle: ArtStyle,
): Promise<MockSceneRenderResult> {
	const wbPngsByScene = new Map<string, Blob[]>();
	for (const beat of tree.beats) {
		for (const scene of beat.scenes) {
			const spreads: Blob[] = [];
			const count = Math.max(1, scene.spreadCount ?? 1);
			for (let i = 0; i < count; i++) {
				spreads.push(await mockRenderScenePng({ sceneId: scene.sceneId, artStyle }));
			}
			wbPngsByScene.set(scene.sceneId, spreads);
		}
	}
	return { wbPngsByScene };
}
