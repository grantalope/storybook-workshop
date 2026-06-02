// @graph-layer: join
// @rationale: join (privacy filter backend — chokepoint detector implementation)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyFilterBackendWASM.ts

/**
 * PrivacyFilterBackendWASM — fallback when WebGPU is unavailable.
 *
 * Same model as the WebGPU backend but routed through the WASM device. Slower
 * (500–2000ms) but acceptable for the publish path where latency is amortized
 * over the user's deliberate publish action.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6.2
 */

import type { PIICategory, PIIDetection } from '$lib/privacy/PrivacyTypes';
import { stubDetect } from '$lib/privacy/PrivacyFilterBackendStub';
import { mapEntityLabelToCategory } from '$lib/privacy/PrivacyFilterBackendWebGPU';

const MODEL_ID = 'openai/privacy-filter';
const TRANSFORMERS_CDN =
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

let pipelinePromise: Promise<unknown> | null = null;
let pipelineRef: unknown = null;
let warmupAttempted = false;
let warmupOk = false;

async function loadPipeline(): Promise<unknown> {
    if (pipelineRef) return pipelineRef;
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        const m = await import(/* @vite-ignore */ TRANSFORMERS_CDN) as {
            pipeline: (
                task: string,
                model: string,
                opts?: Record<string, unknown>,
            ) => Promise<unknown>;
        };
        const pl = await m.pipeline('token-classification', MODEL_ID, {
            device: 'wasm',
            dtype: 'q8',
        });
        pipelineRef = pl;
        return pl;
    })();
    try {
        return await pipelinePromise;
    } catch (e) {
        pipelinePromise = null;
        throw e;
    }
}

export async function wasmWarmup(): Promise<boolean> {
    if (warmupAttempted) return warmupOk;
    warmupAttempted = true;
    try {
        // WASM works in Node too in principle but we keep it browser-side to
        // share the CDN-load path. In Node test env, fail fast.
        if (typeof window === 'undefined') {
            warmupOk = false;
            return false;
        }
        await loadPipeline();
        await runPipeline('hello world');
        warmupOk = true;
        return true;
    } catch {
        warmupOk = false;
        return false;
    }
}

async function runPipeline(text: string): Promise<unknown[]> {
    const pl = await loadPipeline() as ((
        text: string,
        opts?: Record<string, unknown>,
    ) => Promise<unknown[]>);
    return pl(text, { aggregation_strategy: 'simple' });
}

export async function wasmDetect(text: string): Promise<PIIDetection[]> {
    if (!text) return [];
    if (!warmupOk) {
        const ok = await wasmWarmup();
        if (!ok) return stubDetect(text);
    }
    try {
        const raw = await runPipeline(text);
        return normalize(raw);
    } catch {
        return stubDetect(text);
    }
}

function normalize(raw: unknown[]): PIIDetection[] {
    if (!Array.isArray(raw)) return [];
    const out: PIIDetection[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const e = r as {
            entity?: string;
            entity_group?: string;
            start?: number;
            end?: number;
            word?: string;
            score?: number;
        };
        const label = e.entity_group ?? e.entity ?? '';
        const cat: PIICategory | null = mapEntityLabelToCategory(label);
        if (!cat) continue;
        const start = typeof e.start === 'number' ? e.start : 0;
        const end = typeof e.end === 'number' ? e.end : start + (e.word?.length ?? 0);
        if (end <= start) continue;
        out.push({
            category: cat,
            start,
            end,
            text: typeof e.word === 'string' ? e.word : '',
            confidence: typeof e.score === 'number' ? e.score : 0.9,
        });
    }
    return out;
}
