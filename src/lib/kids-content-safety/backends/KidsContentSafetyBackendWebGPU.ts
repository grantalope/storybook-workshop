// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/backends/KidsContentSafetyBackendWebGPU.ts
//
// Same DistilBERT 7-category classifier as the WASM backend, but with
// `onnxruntime-web` configured to use the `webgpu` execution provider.
// Falls through to WASM on init failure (WebGPU adapter unavailable,
// device-lost, shader compile error).
//
// Same TODO-asset story as WASM (see KIDS_SAFETY_WASM_MODEL_URL note in
// KidsContentSafetyBackendWASM.ts) — until the ONNX bundle is hosted,
// `warmup()` returns false and the service probe falls through.

import type {
    KidsContentSafetyBackend,
    ScanOpts,
    ScanReport,
    SafetyCategory,
} from '../types';
import { ALL_SAFETY_CATEGORIES } from '../types';
import {
    KIDS_SAFETY_WASM_MODEL_URL,
    KIDS_SAFETY_WASM_TOKENIZER_URL,
} from './KidsContentSafetyBackendWASM';

interface OnnxSessionLike {
    run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}
interface TokenizerLike {
    encode(text: string): { ids: number[]; attentionMask: number[] };
}

export class KidsContentSafetyBackendWebGPU implements KidsContentSafetyBackend {
    readonly name = 'webgpu' as const;
    private ready = false;
    private session: OnnxSessionLike | null = null;
    private tokenizer: TokenizerLike | null = null;

    async warmup(): Promise<boolean> {
        if (this.ready) return true;
        if (KIDS_SAFETY_WASM_MODEL_URL === null || KIDS_SAFETY_WASM_TOKENIZER_URL === null) {
            return false;
        }
        // Probe for WebGPU availability before paying the import cost.
        const gpu = (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu;
        if (!gpu) return false;
        try {
            const ort = await import(/* @vite-ignore */ 'onnxruntime-web');
            this.session = (await ort.InferenceSession.create(
                KIDS_SAFETY_WASM_MODEL_URL,
                { executionProviders: ['webgpu'] },
            )) as unknown as OnnxSessionLike;
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
        const seqLen = tokens.ids.length;
        const ort = await import(/* @vite-ignore */ 'onnxruntime-web');
        const feeds: Record<string, unknown> = {
            input_ids: new ort.Tensor(
                'int64',
                new BigInt64Array(tokens.ids.map((n) => BigInt(n))),
                [1, seqLen],
            ),
            attention_mask: new ort.Tensor(
                'int64',
                new BigInt64Array(tokens.attentionMask.map((n) => BigInt(n))),
                [1, seqLen],
            ),
        };
        const results = await this.session.run(feeds);
        const logits = (results.logits ?? results.output ?? results.last_hidden_state)
            ?.data as Float32Array | undefined;
        if (!logits || logits.length < ALL_SAFETY_CATEGORIES.length) return [];
        const reports: ScanReport[] = [];
        for (let i = 0; i < ALL_SAFETY_CATEGORIES.length; i++) {
            const prob = 1 / (1 + Math.exp(-logits[i]));
            reports.push({
                category: ALL_SAFETY_CATEGORIES[i] as SafetyCategory,
                confidence: prob,
            });
        }
        return reports;
    }

    isReady(): boolean {
        return this.ready;
    }
}

const _webgpuSingleton = new KidsContentSafetyBackendWebGPU();
export const webgpuWarmup = () => _webgpuSingleton.warmup();
export const webgpuScan = (text: string, opts: ScanOpts) =>
    _webgpuSingleton.scan(text, opts);
