// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/backends/KidsContentSafetyBackendOllama.ts
//
// Tertiary backend for dev / vitest contexts: POSTs the text to a local
// Ollama instance running a model tagged `kid-safety`. The model is
// expected to return a JSON object with per-category confidence in [0,1]
// for the 7 categories.
//
// Ollama setup (developer-facing — record in implementation-notes.md):
//   1. `ollama serve` on localhost:11434.
//   2. `ollama pull <upstream-base-model>` (placeholder — the actual
//      fine-tuned `kid-safety` tag is produced by the offline pipeline
//      in storybook-workshop-content-safety-model goal).
//   3. Until the fine-tuned tag exists, `warmup()` returns false on
//      receipt of an upstream 404 and the probe falls through to stub.
//
// The backend is NEVER used in production — production traffic resolves
// to WebGPU/WASM. Ollama is the dev-only path because (a) it gives
// deterministic structured output for fast unit tests, (b) it doesn't
// require WebGPU/WASM on the box, (c) it's the same shape as the
// PrivacyFilter Ollama backend so engineers don't have to learn a new
// protocol.

import type {
    KidsContentSafetyBackend,
    ScanOpts,
    ScanReport,
    SafetyCategory,
} from '../types';
import { ALL_SAFETY_CATEGORIES } from '../types';

export const KIDS_SAFETY_OLLAMA_URL = 'http://localhost:11434/api/generate';
export const KIDS_SAFETY_OLLAMA_MODEL = 'kid-safety';

const SYSTEM_PROMPT = `You are a children's-book content safety classifier.
Given an input text, output a JSON object with the EXACT keys:
  violence, fear_permanent, sexual_adult, substance, religious_political,
  scary_unresolved, bigotry
Each value is a floating-point probability in [0,1] that the input contains
content in that category. Output ONLY the JSON object — no prose.`;

export class KidsContentSafetyBackendOllama implements KidsContentSafetyBackend {
    readonly name = 'ollama' as const;
    private ready = false;
    private endpoint: string;
    private model: string;

    constructor(opts?: { endpoint?: string; model?: string }) {
        this.endpoint = opts?.endpoint ?? KIDS_SAFETY_OLLAMA_URL;
        this.model = opts?.model ?? KIDS_SAFETY_OLLAMA_MODEL;
    }

    async warmup(): Promise<boolean> {
        if (this.ready) return true;
        if (typeof fetch !== 'function') return false;
        try {
            // Probe with a 1-token generation to surface 404 (model
            // missing) or ECONNREFUSED (ollama not running) early.
            const probe = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: 'ping',
                    stream: false,
                    options: { num_predict: 1 },
                }),
            });
            if (!probe.ok) {
                this.ready = false;
                return false;
            }
            this.ready = true;
            return true;
        } catch {
            this.ready = false;
            return false;
        }
    }

    async scan(text: string, _opts: ScanOpts): Promise<ScanReport[]> {
        if (!this.ready) return [];
        try {
            const res = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    system: SYSTEM_PROMPT,
                    prompt: text,
                    stream: false,
                    format: 'json',
                }),
            });
            if (!res.ok) return [];
            const body = (await res.json()) as { response?: string };
            const parsed = JSON.parse(body.response ?? '{}') as Record<string, unknown>;
            const reports: ScanReport[] = [];
            for (const category of ALL_SAFETY_CATEGORIES) {
                const v = parsed[category];
                const num = typeof v === 'number' ? v : 0;
                reports.push({
                    category: category as SafetyCategory,
                    confidence: Math.max(0, Math.min(1, num)),
                });
            }
            return reports;
        } catch {
            return [];
        }
    }

    isReady(): boolean {
        return this.ready;
    }
}

const _ollamaSingleton = new KidsContentSafetyBackendOllama();
export const ollamaWarmup = () => _ollamaSingleton.warmup();
export const ollamaScan = (text: string, opts: ScanOpts) =>
    _ollamaSingleton.scan(text, opts);
