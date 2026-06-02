// @graph-layer: join
// @rationale: join (privacy filter backend — chokepoint detector implementation)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyFilterBackendWebGPU.ts

/**
 * PrivacyFilterBackendWebGPU — primary backend.
 *
 * Wraps the OpenAI Privacy Filter (1.5B param token classifier, Apache 2.0)
 * via @huggingface/transformers loaded from CDN to avoid Vite optimizer issues
 * (CLAUDE.md "Vite + @xenova/transformers" gotcha).
 *
 * Falls back to {@link stubDetect} on any failure: WebGPU unavailable, model
 * download failure, runtime error. The PrivacyFilterService still gets a
 * useful answer; the user is just temporarily on the regex backend.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6.2
 */

import type { PIICategory, PIIDetection } from '$lib/privacy/PrivacyTypes';
import { stubDetect } from '$lib/privacy/PrivacyFilterBackendStub';

const MODEL_ID = 'openai/privacy-filter';
const TRANSFORMERS_CDN =
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

let pipelinePromise: Promise<unknown> | null = null;
let pipelineRef: unknown = null;
let warmupAttempted = false;
let warmupOk = false;

/**
 * Map raw HF token-classification entity labels to our {@link PIICategory}
 * union. Unknown labels return null (caller drops the detection).
 *
 * The OpenAI Privacy Filter labels follow the typical PII taxonomy with
 * BIO-style prefixes (B-, I-) which the pipeline already collapses.
 */
export function mapEntityLabelToCategory(label: string): PIICategory | null {
    if (!label) return null;
    const norm = label.replace(/^[BI]-/, '').toLowerCase();
    switch (norm) {
        case 'person':
        case 'name':
        case 'per':
        case 'first_name':
        case 'last_name':
            return 'name';
        case 'address':
        case 'street_address':
        case 'loc':
        case 'location':
            return 'address';
        case 'email':
        case 'email_address':
            return 'email';
        case 'phone':
        case 'phone_number':
        case 'telephone':
            return 'phone';
        case 'url':
        case 'link':
            return 'url';
        case 'date':
        case 'date_of_birth':
        case 'dob':
        case 'time':
            return 'date';
        case 'account':
        case 'account_number':
        case 'card':
        case 'credit_card':
        case 'iban':
        case 'ssn':
        case 'tax_id':
            return 'account_number';
        case 'secret':
        case 'api_key':
        case 'token':
        case 'password':
        case 'key':
            return 'secret';
        default:
            return null;
    }
}

async function loadPipeline(): Promise<unknown> {
    if (pipelineRef) return pipelineRef;
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        // CDN dynamic import — Vite must NOT optimize this path.
        const m = await import(/* @vite-ignore */ TRANSFORMERS_CDN) as {
            pipeline: (
                task: string,
                model: string,
                opts?: Record<string, unknown>,
            ) => Promise<unknown>;
        };
        const pl = await m.pipeline('token-classification', MODEL_ID, {
            device: 'webgpu',
            dtype: 'q4',
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

export async function webgpuWarmup(): Promise<boolean> {
    if (warmupAttempted) return warmupOk;
    warmupAttempted = true;
    try {
        // Browser-only: fail fast in Node test env.
        if (typeof navigator === 'undefined' || !(navigator as { gpu?: unknown }).gpu) {
            warmupOk = false;
            return false;
        }
        await loadPipeline();
        // Single-token sanity probe.
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

/**
 * Detect PII spans via the WebGPU model. On any error returns the stub result
 * so the gate stays operational.
 */
export async function webgpuDetect(text: string): Promise<PIIDetection[]> {
    if (!text) return [];
    if (!warmupOk) {
        const ok = await webgpuWarmup();
        if (!ok) return stubDetect(text);
    }
    try {
        const raw = await runPipeline(text);
        return normalize(raw, text);
    } catch {
        return stubDetect(text);
    }
}

function normalize(raw: unknown[], _text: string): PIIDetection[] {
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
        const cat = mapEntityLabelToCategory(label);
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
