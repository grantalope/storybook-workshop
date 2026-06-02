// @graph-layer: join
// @rationale: join (privacy filter backend — chokepoint detector implementation)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyFilterBackendOllama.ts

/**
 * PrivacyFilterBackendOllama — headless / dev fallback.
 *
 * Posts to a local Ollama instance running a `privacy-filter` model and
 * expects a JSON-shaped response listing PII spans. Used when neither WebGPU
 * nor WASM are available (Playwright, Node test env with Ollama running).
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6.2
 */

import type { PIICategory, PIIDetection } from '$lib/privacy/PrivacyTypes';
import { stubDetect } from '$lib/privacy/PrivacyFilterBackendStub';
import { mapEntityLabelToCategory } from '$lib/privacy/PrivacyFilterBackendWebGPU';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'privacy-filter';

const SYSTEM_PROMPT = `You are a strict PII detector. Given an input text, return a JSON object with a single key "spans". Each span is { "label": <one of: name, address, email, phone, url, date, account_number, secret>, "start": <inclusive char offset>, "end": <exclusive char offset>, "text": <substring>, "confidence": <0-1 float> }. Return spans for every PII occurrence; return { "spans": [] } if none. Never return commentary.`;

let warmupAttempted = false;
let warmupOk = false;

export async function ollamaWarmup(): Promise<boolean> {
    if (warmupAttempted) return warmupOk;
    warmupAttempted = true;
    try {
        const env = (import.meta as any)?.env ?? {};
        if (typeof window !== 'undefined' && env.VITE_ENABLE_OLLAMA_PROBE !== 'true') {
            warmupOk = false;
            return false;
        }
        if (typeof fetch === 'undefined') {
            warmupOk = false;
            return false;
        }
        // Single ping to /api/tags first to verify Ollama is up.
        const res = await fetch('http://localhost:11434/api/tags', { method: 'GET' });
        if (!res.ok) {
            warmupOk = false;
            return false;
        }
        warmupOk = true;
        return true;
    } catch {
        warmupOk = false;
        return false;
    }
}

export async function ollamaDetect(text: string): Promise<PIIDetection[]> {
    if (!text) return [];
    if (!warmupOk) {
        const ok = await ollamaWarmup();
        if (!ok) return stubDetect(text);
    }
    try {
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                prompt: `${SYSTEM_PROMPT}\n\nINPUT:\n${text}\n\nJSON:`,
                stream: false,
                format: 'json',
            }),
        });
        if (!res.ok) return stubDetect(text);
        const json = await res.json() as { response?: string };
        const raw = json.response ?? '';
        return parseSpans(raw, text);
    } catch {
        return stubDetect(text);
    }
}

function parseSpans(raw: string, text: string): PIIDetection[] {
    let parsed: { spans?: unknown };
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!parsed || !Array.isArray(parsed.spans)) return [];
    const out: PIIDetection[] = [];
    for (const s of parsed.spans) {
        if (!s || typeof s !== 'object') continue;
        const span = s as {
            label?: string;
            start?: number;
            end?: number;
            text?: string;
            confidence?: number;
        };
        const label = span.label ?? '';
        const cat: PIICategory | null = mapEntityLabelToCategory(label);
        if (!cat) continue;
        const start = typeof span.start === 'number' ? span.start : -1;
        const end = typeof span.end === 'number' ? span.end : -1;
        if (start < 0 || end <= start || end > text.length) continue;
        out.push({
            category: cat,
            start,
            end,
            text: typeof span.text === 'string' ? span.text : text.slice(start, end),
            confidence: typeof span.confidence === 'number' ? span.confidence : 0.85,
        });
    }
    return out;
}
