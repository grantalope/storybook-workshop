// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/backends/KidsContentSafetyBackendWASM.ts
//
// DistilBERT-based 7-category multi-label classifier running via
// `onnxruntime-web` WASM backend. ~30 MB bundle (model + tokenizer +
// vocab) loaded lazily from a CDN URL on first `warmup()`.
//
// CURRENT STATUS (2026-05-24): The ONNX model bundle is a TODO-asset —
// fine-tuning needs an offline pipeline + hosting decision (Cloudflare R2
// vs Vercel Blob vs custom CDN). Until the asset URL is committed in
// `KIDS_SAFETY_WASM_MODEL_URL`, `warmup()` returns false and the service
// probe falls through to Ollama/stub. The fine-tuning corpus + script is
// tracked in a separate offline-pipeline goal (storybook-workshop-
// content-safety-model). See implementation-notes.md → "ONNX bundle
// deployment plan".
//
// The class implements `KidsContentSafetyBackend` so the service can
// `_loadBackend('wasm')` exactly as it does for stub/ollama. The probe
// path is correct end-to-end TODAY; flipping the URL constant from null
// to the hosted asset URL is the only change needed to activate WASM.

import type {
    KidsContentSafetyBackend,
    ScanOpts,
    ScanReport,
    SafetyCategory,
} from '../types';
import { ALL_SAFETY_CATEGORIES } from '../types';

// Asset URL is null until the ONNX bundle is hosted. The variable is exported
// for tests + debug surfaces — they read it to render "WASM model unhosted"
// state honestly rather than pretending the backend is just broken.
export const KIDS_SAFETY_WASM_MODEL_URL: string | null = null;
export const KIDS_SAFETY_WASM_TOKENIZER_URL: string | null = null;

interface OnnxSessionLike {
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}

interface TokenizerLike {
    encode(text: string): { ids: number[]; attentionMask: number[] };
}

export class KidsContentSafetyBackendWASM implements KidsContentSafetyBackend {
    readonly name = 'wasm' as const;
    private ready = false;
    private session: OnnxSessionLike | null = null;
    private tokenizer: TokenizerLike | null = null;

    async warmup(): Promise<boolean> {
        if (this.ready) return true;
        if (KIDS_SAFETY_WASM_MODEL_URL === null || KIDS_SAFETY_WASM_TOKENIZER_URL === null) {
            // ONNX bundle isn't hosted yet — caller must probe the next
            // backend in the chain. We return false (not throw) so the
            // service's lazy probe loop counts this as a clean miss.
            return false;
        }
        try {
            // Dynamic import keeps onnxruntime-web out of the critical bundle.
            // The /* @vite-ignore */ hint tells Vite NOT to eagerly resolve
            // the alias — the dep optimizer cannot handle ort-web's wasm
            // entrypoint (similar problem to `@xenova/transformers`, project
            // gotcha doc in pachinko CLAUDE.md).
            const ort = await import(/* @vite-ignore */ 'onnxruntime-web');
            this.session = (await ort.InferenceSession.create(
                KIDS_SAFETY_WASM_MODEL_URL,
                { executionProviders: ['wasm'] },
            )) as unknown as OnnxSessionLike;

            // Tokenizer: small `@xenova/transformers` BERT tokenizer loaded
            // from CDN (cannot go through Vite optimizer per pachinko CLAUDE).
            const xenova = await import(
                // @ts-expect-error — runtime CDN URL has no static type
                /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
            );
            const tokenizer = await xenova.AutoTokenizer.from_pretrained(
                KIDS_SAFETY_WASM_TOKENIZER_URL,
            );
            this.tokenizer = tokenizer as unknown as TokenizerLike;

            this.ready = true;
            return true;
        } catch {
            this.ready = false;
            return false;
        }
    }

    async scan(text: string, _opts: ScanOpts): Promise<ScanReport[]> {
        if (!this.ready || !this.session || !this.tokenizer) return [];

        const tokens = this.tokenizer.encode(text);
        const inputIds = new BigInt64Array(tokens.ids.map((n) => BigInt(n)));
        const attentionMask = new BigInt64Array(
            tokens.attentionMask.map((n) => BigInt(n)),
        );

        // Build minimal-shape input feed compatible with HF text-classification
        // export. Shape: [1, seq_len].
        const seqLen = tokens.ids.length;
        const ort = await import(/* @vite-ignore */ 'onnxruntime-web');
        const feeds: Record<string, unknown> = {
            input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
            attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
        };

        const results = await this.session.run(feeds);
        // Multi-label sigmoid head — logits → 1/(1+e^-x) per category.
        const logits = (results.logits ?? results.output ?? results.last_hidden_state)
            ?.data as Float32Array | undefined;
        if (!logits || logits.length < ALL_SAFETY_CATEGORIES.length) return [];

        const reports: ScanReport[] = [];
        for (let i = 0; i < ALL_SAFETY_CATEGORIES.length; i++) {
            const logit = logits[i];
            const prob = 1 / (1 + Math.exp(-logit));
            const category = ALL_SAFETY_CATEGORIES[i] as SafetyCategory;
            // Emit a report at any non-trivial confidence — the threshold
            // logic lives in the service facade (default 0.5, strict 0.3).
            // The WASM backend doesn't have character spans in the multi-
            // label head — leave `span` undefined.
            reports.push({ category, confidence: prob });
        }
        return reports;
    }

    isReady(): boolean {
        return this.ready;
    }
}

// Function-style API for probe-order parity with the privacy backend
// pattern (`webgpuDetect` / `webgpuWarmup`).
const _wasmSingleton = new KidsContentSafetyBackendWASM();
export const wasmWarmup = () => _wasmSingleton.warmup();
export const wasmScan = (text: string, opts: ScanOpts) => _wasmSingleton.scan(text, opts);
