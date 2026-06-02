// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/KidsContentSafetyService.ts
//
// Public-API entry point for the kids content-safety gate. Mirrors the
// pattern in PrivacyFilterService — lazy backend probe (webgpu → wasm →
// ollama → stub), backend stats counters, _setProbeOrderForTests, etc.
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md
//   §4.1 (categories + probe order + threshold policy)
//   §4.2 (five enforcement gates the service feeds)
//
// THE GATE CONTRACT: callers pass text + source + opts, get back
// `ScanResult`. If `passed === false` the caller MUST refuse the upstream
// LLM call (story author, dedication, scene-brief outbound, etc.) — same
// way PrivacyFilter's `hardFail === true` blocks upstream publish.

import type {
    BackendName,
    KidsContentSafetyBackend,
    ScanOpts,
    ScanReport,
    ScanResult,
} from './types';
import { SCAN_THRESHOLDS } from './types';
import { stubScan, stubWarmup } from './backends/KidsContentSafetyBackendStub';
import { kidsContentSafetyAudit } from './KidsContentSafetyAudit';

interface BackendModule {
    scan: (text: string, opts: ScanOpts) => Promise<ScanReport[]>;
    warmup: () => Promise<boolean>;
}

export class KidsContentSafetyService {
    private backend: BackendName = 'stub';
    private resolvedBackend: BackendName | null = null;
    private probeOrder: BackendName[] = ['webgpu', 'wasm', 'ollama', 'stub'];
    private warmupPromise: Promise<void> | null = null;
    private readyFlag = false;
    private dynamicBackends: Partial<Record<BackendName, BackendModule | null>> = {};

    // Operator counters — mirrors PrivacyFilterService Round-33 panel.
    // Exposed via getBackendStats() for the debug page.
    private _warmupAttempts: Record<BackendName, number> = {
        webgpu: 0,
        wasm: 0,
        ollama: 0,
        stub: 0,
    };
    private _warmupFailures: Record<BackendName, number> = {
        webgpu: 0,
        wasm: 0,
        ollama: 0,
        stub: 0,
    };
    private _scanCount: Record<BackendName, number> = {
        webgpu: 0,
        wasm: 0,
        ollama: 0,
        stub: 0,
    };
    private _scanFailures: Record<BackendName, number> = {
        webgpu: 0,
        wasm: 0,
        ollama: 0,
        stub: 0,
    };

    async warmup(): Promise<void> {
        if (this.warmupPromise) return this.warmupPromise;
        this.warmupPromise = this._doWarmup();
        return this.warmupPromise;
    }

    private async _doWarmup(): Promise<void> {
        for (const candidate of this.probeOrder) {
            this._warmupAttempts[candidate]++;
            try {
                const mod = await this._loadBackend(candidate);
                if (!mod) {
                    this._warmupFailures[candidate]++;
                    continue;
                }
                const ok = await mod.warmup();
                if (ok) {
                    this.backend = candidate;
                    this.resolvedBackend = candidate;
                    this.readyFlag = true;
                    return;
                }
                this._warmupFailures[candidate]++;
            } catch {
                this._warmupFailures[candidate]++;
            }
        }
        // Stub always wins — redundant safety.
        this.backend = 'stub';
        this.resolvedBackend = 'stub';
        this.readyFlag = true;
    }

    isReady(): boolean {
        return this.readyFlag;
    }

    activeBackend(): BackendName {
        return this.backend;
    }

    /**
     * Scan `text` for the 7 kids-content-safety categories.
     *
     * Returns `passed === false` if any report's confidence ≥ threshold.
     * Default threshold 0.5; `opts.strict === true` lowers to 0.3 (used
     * for the parent-typed dedication + cover-badge free-text gates).
     */
    async scan(text: string, opts: ScanOpts): Promise<ScanResult> {
        const startedAt = nowMs();
        const safeText = typeof text === 'string' ? text : '';
        if (!safeText) {
            const result: ScanResult = {
                passed: true,
                reports: [],
                scanLatencyMs: 0,
                backend: this.backend,
            };
            // Audit empty-input scans too — surface them on /debug so
            // operators see callers passing nothing.
            kidsContentSafetyAudit.record({
                source: opts.source,
                result,
                text: safeText,
                ts: Date.now(),
            });
            return result;
        }

        if (!this.readyFlag) await this.warmup();

        const chosen = opts.forceBackend ?? this.backend;
        const reports = await this._dispatch(chosen, safeText, opts);

        const threshold =
            opts.strict === true ? SCAN_THRESHOLDS.strict : SCAN_THRESHOLDS.default;
        const passed = reports.every((r) => r.confidence < threshold);

        const result: ScanResult = {
            passed,
            reports,
            scanLatencyMs: nowMs() - startedAt,
            backend: chosen,
        };
        kidsContentSafetyAudit.record({
            source: opts.source,
            result,
            text: safeText,
            ts: Date.now(),
        });
        return result;
    }

    private async _dispatch(
        backend: BackendName,
        text: string,
        opts: ScanOpts,
    ): Promise<ScanReport[]> {
        this._scanCount[backend]++;
        if (backend === 'stub') return stubScan(text);
        const mod = await this._loadBackend(backend);
        if (!mod) {
            this._scanFailures[backend]++;
            return stubScan(text);
        }
        try {
            return await mod.scan(text, opts);
        } catch {
            this._scanFailures[backend]++;
            return stubScan(text);
        }
    }

    private async _loadBackend(
        backend: BackendName,
    ): Promise<BackendModule | null> {
        if (backend === 'stub') {
            return {
                scan: async (t) => stubScan(t),
                warmup: stubWarmup,
            };
        }
        if (backend in this.dynamicBackends) {
            return this.dynamicBackends[backend] ?? null;
        }
        try {
            if (backend === 'webgpu') {
                const m = await import('./backends/KidsContentSafetyBackendWebGPU');
                const mod: BackendModule = {
                    scan: (t, o) => m.webgpuScan(t, o),
                    warmup: m.webgpuWarmup,
                };
                this.dynamicBackends.webgpu = mod;
                return mod;
            }
            if (backend === 'wasm') {
                const m = await import('./backends/KidsContentSafetyBackendWASM');
                const mod: BackendModule = {
                    scan: (t, o) => m.wasmScan(t, o),
                    warmup: m.wasmWarmup,
                };
                this.dynamicBackends.wasm = mod;
                return mod;
            }
            if (backend === 'ollama') {
                const m = await import('./backends/KidsContentSafetyBackendOllama');
                const mod: BackendModule = {
                    scan: (t, o) => m.ollamaScan(t, o),
                    warmup: m.ollamaWarmup,
                };
                this.dynamicBackends.ollama = mod;
                return mod;
            }
        } catch {
            this.dynamicBackends[backend] = null;
            return null;
        }
        return null;
    }

    getBackendStats(): {
        active: BackendName;
        probeOrder: BackendName[];
        warmup: Record<BackendName, { attempts: number; failures: number }>;
        scan: Record<
            BackendName,
            { count: number; failures: number; failureRate: number }
        >;
    } {
        const scan = {} as Record<
            BackendName,
            { count: number; failures: number; failureRate: number }
        >;
        const warmup = {} as Record<
            BackendName,
            { attempts: number; failures: number }
        >;
        const all: BackendName[] = ['webgpu', 'wasm', 'ollama', 'stub'];
        for (const b of all) {
            const count = this._scanCount[b];
            const failures = this._scanFailures[b];
            scan[b] = {
                count,
                failures,
                failureRate: count === 0 ? 0 : failures / count,
            };
            warmup[b] = {
                attempts: this._warmupAttempts[b],
                failures: this._warmupFailures[b],
            };
        }
        return {
            active: this.backend,
            probeOrder: [...this.probeOrder],
            warmup,
            scan,
        };
    }

    clearBackendStats(): void {
        const all: BackendName[] = ['webgpu', 'wasm', 'ollama', 'stub'];
        for (const b of all) {
            this._warmupAttempts[b] = 0;
            this._warmupFailures[b] = 0;
            this._scanCount[b] = 0;
            this._scanFailures[b] = 0;
        }
    }

    // ── Test-only helpers (not part of the public contract) ──

    _resetForTests(): void {
        this.backend = 'stub';
        this.resolvedBackend = null;
        this.warmupPromise = null;
        this.readyFlag = false;
        this.dynamicBackends = {};
        this.clearBackendStats();
    }

    _setProbeOrderForTests(order: BackendName[]): void {
        this.probeOrder = [...order];
    }

    _setBackendForTests(
        backend: BackendName,
        mod: KidsContentSafetyBackend | BackendModule | null,
    ): void {
        if (!mod) {
            this.dynamicBackends[backend] = null;
            return;
        }
        // Normalize KidsContentSafetyBackend → BackendModule shape.
        if ('name' in mod) {
            this.dynamicBackends[backend] = {
                scan: (t, o) => mod.scan(t, o),
                warmup: mod.warmup,
            };
        } else {
            this.dynamicBackends[backend] = mod;
        }
    }
}

function nowMs(): number {
    if (
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
    ) {
        return performance.now();
    }
    return Date.now();
}

// Singleton — `kidsContentSafetyService` is the canonical entry point that
// every workshop caller (and the kernel manifest module()) imports.
export const kidsContentSafetyService = new KidsContentSafetyService();
