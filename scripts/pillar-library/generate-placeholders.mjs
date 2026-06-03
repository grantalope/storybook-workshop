#!/usr/bin/env node
// @ts-nocheck
// (Codegen script — runs under node, not bundled. svelte-check's tsc pass
//  enforces strict typing on .mjs files via checkJs:true; that's too
//  noisy for a one-shot tool. Logic is covered by vitest assertions.)
/**
 * scripts/pillar-library/generate-placeholders.mjs
 *
 * MVP placeholder pillar-library generator for the storybook-workshop
 * Station 2 grid + PillarManifestClient local fallback.
 *
 * Why this exists
 * ---------------
 * Real Pixal3D-baked 4-view sprite sheets are deferred per ADR-0044
 * (see docs/goals/2026-05-25-pillar-library-pixal3d.md §"Out of scope"
 * for the deferred bake-pipeline). The workshop UI still needs SOMETHING
 * to render at Station 2 today; this script produces 50 deterministic,
 * stratified-random SVG-derived kid avatars with axes, a placeholder
 * 512-dim "CLIP" embedding, and per-pillar preview/front/back/left/right
 * PNGs. The PNG render is identical across all 4 sides (single-view MVP);
 * the multi-view discipline lands with the real Pixal3D bake.
 *
 * Determinism
 * -----------
 * Stratified-random over hair × skin × eye × age-band × clothing-vibe.
 * The 50 archetypes are picked via a fixed-seed PRNG over the cartesian
 * product (8 × 6 × 4 × 3 × 5 = 2880 combos → 50 stratified samples).
 * Each entry's embedding is a 512-dim Float32 derived from
 * SHA-256(canonical-axes-string) seeded into a small SplitMix64 PRNG.
 * Same axes → same embedding, deterministic across runs / hosts.
 *
 * Inputs / outputs
 * ----------------
 * Input:  no env, no flags (deterministic).
 * Output:
 *   static/pillar-library-v1-placeholder/manifest.json        # 50 entries
 *   static/pillar-library-v1-placeholder/{pillarId}/preview.png
 *   static/pillar-library-v1-placeholder/{pillarId}/front.png
 *   static/pillar-library-v1-placeholder/{pillarId}/back.png
 *   static/pillar-library-v1-placeholder/{pillarId}/left.png
 *   static/pillar-library-v1-placeholder/{pillarId}/right.png
 *
 * PNG rasterizer
 * --------------
 * Uses @resvg/resvg-js (a devDependency) when available. If the import
 * fails (CI / minimal-deps env), the script writes the SVG source as an
 * .svg sibling and skips PNG generation with a loud warn; the committed
 * static/ tree is treated as the source of truth so the workshop UI
 * keeps working.
 *
 * Re-run
 * ------
 *   node scripts/pillar-library/generate-placeholders.mjs
 *
 * Output is byte-stable across runs (deterministic PRNG + sorted axes).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'static', 'pillar-library-v1-placeholder');

// ---------- Axis catalog (must match src/lib/services/types.ts) ----------

const HAIR_KINDS = [
    'straight-short',
    'straight-long',
    'wavy-short',
    'wavy-long',
    'curly-short',
    'curly-long',
    'coily',
    'buzz',
];
const SKIN_TONES = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const EYE_COLORS = ['brown', 'blue', 'green', 'hazel'];
const AGE_BANDS = ['toddler', 'preschool', 'grade-school'];
const CLOTHING_VIBES = ['casual', 'sporty', 'formal', 'whimsical', 'cozy'];

const TARGET_COUNT = 50;
const EMBEDDING_DIM = 512;
const SEED_HEX = 'b00ba100'; // stable across runs

// ---------- Stratified sampling ----------

/**
 * Build all axis combinations. Excludes 'extras' (open set; placeholder = []).
 * 8 × 6 × 4 × 3 × 5 = 2880 candidates.
 */
function buildCandidates() {
    const out = [];
    for (const hair of HAIR_KINDS) {
        for (const skinTone of SKIN_TONES) {
            for (const eyeColor of EYE_COLORS) {
                for (const ageBand of AGE_BANDS) {
                    for (const clothingVibe of CLOTHING_VIBES) {
                        out.push({
                            hair,
                            skinTone,
                            eyeColor,
                            ageBand,
                            clothingVibe,
                            extras: [],
                        });
                    }
                }
            }
        }
    }
    return out;
}

/**
 * SplitMix64 PRNG (state is a 64-bit BigInt). Deterministic across all JS
 * engines as long as input seed is the same.
 */
function makePrng(seedBig) {
    let state = BigInt.asUintN(64, seedBig);
    const MASK = (1n << 64n) - 1n;
    return function next() {
        state = (state + 0x9e3779b97f4a7c15n) & MASK;
        let z = state;
        z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
        z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
        z = z ^ (z >> 31n);
        // return float in [0, 1)
        return Number(z & 0xffffffffn) / 0x100000000;
    };
}

function seedFromHex(hex) {
    // pad to 16 hex chars (64 bits)
    const h = hex.padStart(16, '0').slice(-16);
    return BigInt('0x' + h);
}

/**
 * Stratified-random selection: ensure every value of every axis appears
 * at least once in the chosen 50 (when count is high enough). The
 * algorithm picks one combo per axis-stratum first, then fills the
 * remainder with PRNG-weighted random sampling without replacement.
 */
function stratifiedSample(candidates, count, rngHex) {
    const rng = makePrng(seedFromHex(rngHex));
    const chosen = new Map(); // key -> entry
    const key = (e) =>
        `${e.hair}|${e.skinTone}|${e.eyeColor}|${e.ageBand}|${e.clothingVibe}`;

    // Strata: pick one entry per value of each axis (covers every axis value).
    const axes = {
        hair: HAIR_KINDS,
        skinTone: SKIN_TONES,
        eyeColor: EYE_COLORS,
        ageBand: AGE_BANDS,
        clothingVibe: CLOTHING_VIBES,
    };
    for (const [axisName, values] of Object.entries(axes)) {
        for (const v of values) {
            if (chosen.size >= count) break;
            const matching = candidates.filter((c) => c[axisName] === v);
            // pick one that's not already chosen
            const avail = matching.filter((m) => !chosen.has(key(m)));
            if (avail.length === 0) continue;
            const idx = Math.floor(rng() * avail.length);
            const pick = avail[idx];
            chosen.set(key(pick), pick);
        }
    }

    // Fill the remainder with uniform sampling without replacement
    const pool = candidates.filter((c) => !chosen.has(key(c)));
    // Sort pool for determinism (Array order from cartesian product is already
    // deterministic, but be explicit).
    pool.sort((a, b) => (key(a) < key(b) ? -1 : 1));
    while (chosen.size < count && pool.length > 0) {
        const idx = Math.floor(rng() * pool.length);
        const pick = pool.splice(idx, 1)[0];
        chosen.set(key(pick), pick);
    }
    // Return in deterministic order: sort by key for stable manifest output
    return [...chosen.values()].sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

// ---------- Deterministic embedding ----------

/**
 * Canonical axes string: stable serialization for SHA-256 seeding.
 */
function canonicalAxesString(axes) {
    return [
        `hair=${axes.hair}`,
        `skinTone=${axes.skinTone}`,
        `eyeColor=${axes.eyeColor}`,
        `ageBand=${axes.ageBand}`,
        `clothingVibe=${axes.clothingVibe}`,
        `extras=[${[...axes.extras].sort().join(',')}]`,
    ].join('|');
}

/**
 * 512-dim deterministic pseudo-CLIP embedding for a pillar.
 *
 * Method: SHA-256(canonical axes) → 64-bit seed → SplitMix64 → 512 floats
 * uniformly in [-1, 1]. L2-normalize so cosine-sim and matcher behavior
 * stays well-conditioned.
 *
 * This is NOT a real CLIP embedding — it's a placeholder whose only job
 * is to populate the manifest schema. The real Pixal3D bake (deferred)
 * will replace these with CLIP-ViT-Base-Patch32 vectors.
 */
function deterministicEmbedding(axes) {
    const hash = createHash('sha256').update(canonicalAxesString(axes)).digest();
    // first 8 bytes -> 64-bit seed
    const seedBig = hash.readBigUInt64BE(0);
    const rng = makePrng(seedBig);
    const out = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        out[i] = rng() * 2 - 1;
    }
    // L2 normalize
    let sumSq = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) sumSq += out[i] * out[i];
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = out[i] / norm;
    return Array.from(out);
}

// ---------- SVG composition ----------

const SKIN_RGB = {
    I: '#f7d7be',
    II: '#e9b994',
    III: '#cc996f',
    IV: '#a87454',
    V: '#7d4d34',
    VI: '#4f2f1f',
};

const HAIR_RGB_FOR_SKIN = (skin) => {
    // map skin tone to a plausible-yet-arbitrary hair color; pure
    // placeholder cosmetics.
    switch (skin) {
        case 'I':
            return '#d4a55a';
        case 'II':
            return '#a87344';
        case 'III':
            return '#6b4a2b';
        case 'IV':
            return '#3a2616';
        case 'V':
            return '#241409';
        case 'VI':
            return '#0e0905';
        default:
            return '#3a2616';
    }
};

const EYE_RGB = {
    brown: '#5a3b18',
    blue: '#3c6db0',
    green: '#4d8f4a',
    hazel: '#8e6a3a',
};

const VIBE_RGB = {
    casual: '#3b8de8',
    sporty: '#e84747',
    formal: '#26314e',
    whimsical: '#c050d5',
    cozy: '#d68d3a',
};

const AGE_HEAD_RADIUS = {
    toddler: 28,
    preschool: 26,
    'grade-school': 24,
};

function hairPath(kind) {
    // simple deterministic hair silhouettes by kind, drawn on a 128×128 canvas
    // around the head at (64, 56).
    switch (kind) {
        case 'straight-short':
            return 'M30,42 Q64,18 98,42 L98,60 L30,60 Z';
        case 'straight-long':
            return 'M28,42 Q64,16 100,42 L102,90 Q92,80 90,60 L40,60 Q36,80 26,90 Z';
        case 'wavy-short':
            return 'M28,46 Q40,22 64,28 Q88,22 100,46 L100,62 Q88,52 80,60 Q64,52 48,60 Q40,52 28,62 Z';
        case 'wavy-long':
            return 'M26,46 Q40,16 64,24 Q88,16 102,46 L104,94 Q92,76 88,62 L40,62 Q36,76 24,94 Z';
        case 'curly-short':
            return 'M32,44 a8,8 0 0,1 14,-6 a8,8 0 0,1 16,0 a8,8 0 0,1 16,0 a8,8 0 0,1 14,6 L96,60 L32,60 Z';
        case 'curly-long':
            return 'M28,46 a10,10 0 0,1 14,-8 a10,10 0 0,1 22,0 a10,10 0 0,1 22,0 a10,10 0 0,1 14,8 L102,92 Q88,82 84,64 L44,64 Q40,82 26,92 Z';
        case 'coily':
            return 'M30,44 a6,6 0 0,1 8,-4 a6,6 0 0,1 10,0 a6,6 0 0,1 10,0 a6,6 0 0,1 10,0 a6,6 0 0,1 10,0 a6,6 0 0,1 10,0 a6,6 0 0,1 10,0 a6,6 0 0,1 8,4 L98,60 L30,60 Z';
        case 'buzz':
            return 'M36,46 Q64,38 92,46 L92,52 L36,52 Z';
        default:
            return 'M30,42 Q64,18 98,42 L98,60 L30,60 Z';
    }
}

function ageBandLabel(ageBand) {
    return ageBand;
}

/**
 * Compose an SVG kid avatar. Single-view; the back/left/right files are
 * the same SVG re-rendered (MVP). The render dimensions are 128×128.
 */
function composeSvg(pillarId, axes) {
    const skin = SKIN_RGB[axes.skinTone];
    const hairColor = HAIR_RGB_FOR_SKIN(axes.skinTone);
    const eye = EYE_RGB[axes.eyeColor];
    const vibe = VIBE_RGB[axes.clothingVibe];
    const headR = AGE_HEAD_RADIUS[axes.ageBand];
    const hair = hairPath(axes.hair);
    const ageLabel = ageBandLabel(axes.ageBand);

    // background tint per vibe (gentle)
    const bg = `${vibe}22`; // 22 = ~13% alpha as hex pair (low-saturation tile)

    // anti-injection: axes values come from a closed enum set, but escape anyway.
    const txt = (s) => String(s).replace(/[<>&"']/g, (c) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]),
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="kid pillar ${pillarId}">
  <rect width="128" height="128" fill="${bg}"/>
  <!-- body / shirt -->
  <path d="M30,128 Q30,96 64,90 Q98,96 98,128 Z" fill="${vibe}"/>
  <!-- neck -->
  <rect x="58" y="80" width="12" height="10" fill="${skin}"/>
  <!-- head -->
  <circle cx="64" cy="56" r="${headR}" fill="${skin}"/>
  <!-- hair -->
  <path d="${hair}" fill="${hairColor}"/>
  <!-- eyes -->
  <circle cx="56" cy="58" r="2.4" fill="${eye}"/>
  <circle cx="72" cy="58" r="2.4" fill="${eye}"/>
  <!-- mouth (smile) -->
  <path d="M58,68 Q64,72 70,68" stroke="#5a2f20" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <!-- age glyph in corner -->
  <text x="4" y="124" font-family="monospace" font-size="8" fill="#33333399">${txt(ageLabel)}</text>
  <!-- pillar id corner -->
  <text x="124" y="10" font-family="monospace" font-size="7" fill="#33333399" text-anchor="end">#${pillarId}</text>
</svg>`;
}

// ---------- PNG rasterizer (resvg if available, SVG fallback otherwise) ----------

async function tryLoadResvg() {
    try {
        const mod = await import('@resvg/resvg-js');
        return mod.Resvg ?? mod.default?.Resvg ?? null;
    } catch {
        return null;
    }
}

function renderPngFromSvg(Resvg, svgStr) {
    const r = new Resvg(svgStr, {
        fitTo: { mode: 'width', value: 256 },
        background: 'rgba(255,255,255,0)',
    });
    const buf = r.render().asPng();
    return buf;
}

// ---------- Main ----------

async function main() {
    const candidates = buildCandidates();
    const chosen = stratifiedSample(candidates, TARGET_COUNT, SEED_HEX);
    if (chosen.length !== TARGET_COUNT) {
        throw new Error(
            `Generator picked ${chosen.length} entries; expected ${TARGET_COUNT}`,
        );
    }

    const Resvg = await tryLoadResvg();
    if (!Resvg) {
        console.warn(
            '[generate-placeholders] @resvg/resvg-js unavailable; writing .svg only. Install the devDep to regenerate PNGs.',
        );
    }

    mkdirSync(OUT_DIR, { recursive: true });

    const manifest = [];
    for (let i = 0; i < chosen.length; i++) {
        const axes = chosen[i];
        const pillarId = 1000 + i; // stable opaque int range
        const svg = composeSvg(pillarId, axes);
        const dir = resolve(OUT_DIR, String(pillarId));
        mkdirSync(dir, { recursive: true });
        if (Resvg) {
            const png = renderPngFromSvg(Resvg, svg);
            for (const view of ['preview', 'front', 'back', 'left', 'right']) {
                writeFileSync(resolve(dir, `${view}.png`), png);
            }
        } else {
            // Fall back: write the SVG source so the workshop UI can <img src=...>
            // it; not ideal but keeps the asset path populated.
            for (const view of ['preview', 'front', 'back', 'left', 'right']) {
                writeFileSync(resolve(dir, `${view}.svg`), svg);
            }
        }
        manifest.push({
            pillarId,
            axes,
            embedding: deterministicEmbedding(axes),
            urls: {
                preview: `/pillar-library-v1-placeholder/${pillarId}/preview.${Resvg ? 'png' : 'svg'}`,
                front: `/pillar-library-v1-placeholder/${pillarId}/front.${Resvg ? 'png' : 'svg'}`,
                back: `/pillar-library-v1-placeholder/${pillarId}/back.${Resvg ? 'png' : 'svg'}`,
                left: `/pillar-library-v1-placeholder/${pillarId}/left.${Resvg ? 'png' : 'svg'}`,
                right: `/pillar-library-v1-placeholder/${pillarId}/right.${Resvg ? 'png' : 'svg'}`,
            },
        });
    }
    const json = JSON.stringify(manifest, null, 2) + '\n';
    writeFileSync(resolve(OUT_DIR, 'manifest.json'), json);
    console.log(
        `[generate-placeholders] wrote ${manifest.length} pillars to ${OUT_DIR} (${Resvg ? 'PNG' : 'SVG'} mode).`,
    );
}

// Allow `node generate-placeholders.mjs` AND `node --experimental-vm-modules ...`
const isMain =
    process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
    main().catch((err) => {
        console.error('[generate-placeholders] failed:', err);
        process.exit(1);
    });
}

export {
    HAIR_KINDS,
    SKIN_TONES,
    EYE_COLORS,
    AGE_BANDS,
    CLOTHING_VIBES,
    TARGET_COUNT,
    EMBEDDING_DIM,
    SEED_HEX,
    buildCandidates,
    stratifiedSample,
    deterministicEmbedding,
    canonicalAxesString,
    composeSvg,
};
