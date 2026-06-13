import { uuid } from '$lib/util/uuid';
// @graph-layer: join
// @rationale: join (privacy filter — the canonical chokepoint for every private→universal write)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyFilterService.ts

/**
 * PrivacyFilterService — the single canonical PII gate.
 *
 * Wraps the backend trifecta (WebGPU → WASM → Ollama → stub) behind a
 * `scrub(text, opts)` API that returns a deterministic {@link FilterReport}.
 * The service is the **only** place in the app that decides whether a piece
 * of text contains PII; every gate (recipe publish, claw ingest, free-text
 * card, agent prompt) routes through it.
 *
 * Hard categories produce `hardFail: true`; the caller MUST refuse to publish
 * the upstream artifact in that case. Soft categories are auto-redacted but
 * allowed to flow on.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6
 */

import type {
    FilterReport,
    PIICategory,
    PIIDetection,
    ScrubOptions,
} from '$lib/privacy/PrivacyTypes';
import { HARD_CATEGORIES, SOFT_CATEGORIES } from '$lib/privacy/PrivacyTypes';
import { stubDetect, stubWarmup } from '$lib/privacy/PrivacyFilterBackendStub';
import { checkAndAudit } from '$lib/kernel-contracts/purpose';
import type { PolicyCheckInput, PolicyDecision } from '$lib/kernel-contracts/purpose/PurposeTypes';
import { getKernel } from '$lib/kernel-contracts/helpers/get-kernel';
import type { KernelLike } from '$lib/kernel-contracts/helpers/define-kernel-mirror';
import { connectCached } from '$lib/kernel-contracts/helpers/port-cache';
import { privacyAuditService } from './PrivacyAuditService';
import type {
    CrossLayerWriteAudit,
    PrivacyRedaction,
    PublishToUniversalOptions,
    PublishToUniversalResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Stage 17 (Phase 4C, 2026-04-29) — kernel-mediated purpose.check helper.
//
// PrivacyFilterService gates two call sites on `checkAndAudit`:
//   1. Untagged free-text path (audit-only, purpose='unspecified').
//   2. Purpose-tagged path (gates the scrub by policy decision.allowed).
//
// Prefer the kernel-mediated route so /debug/os can attribute these high-
// volume policy checks to the `purpose` kernel process. When the kernel isn't
// ready yet (cold boot race) or in tests, fall back to the direct
// `checkAndAudit` import which is the singleton path.
//
// The helper returns a `PolicyDecision` so the gate-path that needs
// `.allowed` keeps working unchanged. The audit ring buffer receives the
// record either way (kernel proxy → checkAndAudit → audit, or direct →
// checkAndAudit → audit).
// ─────────────────────────────────────────────────────────────────────────────

type PurposeKernelLike = KernelLike;

interface PurposePort {
    check: (input: PolicyCheckInput, agentId?: string) => PolicyDecision;
}

async function _privacyPurposeKernelCheck(
    input: PolicyCheckInput,
    agentId?: string,
    kernelOverride?: PurposeKernelLike | null,
): Promise<PolicyDecision> {
    const k = kernelOverride !== undefined ? kernelOverride : getKernel();
    const ready = k && (typeof k.isReady === 'function' ? k.isReady() : true);
    if (k && ready) {
        try {
            const port = (await connectCached(k, 'purpose.check', 'privacy-filter-service')) as unknown as PurposePort;
            return await Promise.resolve(port.check(input, agentId));
        } catch (err) {
            console.warn('[PrivacyFilterService] kernel purpose route failed, falling back to checkAndAudit:', err);
        }
    }
    return checkAndAudit(input, agentId);
}

export const __TEST_PrivacyPurposeKernel = {
    check: _privacyPurposeKernelCheck,
};

type Backend = 'webgpu' | 'wasm' | 'ollama' | 'stub';

interface BackendModule {
    detect: (text: string) => Promise<PIIDetection[]>;
    warmup: () => Promise<boolean>;
}

export class PrivacyFilterService {
    private backend: Backend = 'stub';
    private resolvedBackend: Backend | null = null;
    private probeOrder: Backend[] = ['webgpu', 'wasm', 'ollama', 'stub'];
    private warmupPromise: Promise<void> | null = null;
    private readyFlag = false;
    private dynamicBackends: Partial<Record<Backend, BackendModule | null>> = {};

    /**
     * Round-33 — backend probe + dispatch counters.
     *
     * Pre-round-33 there were three silent fall-through paths in this service:
     *
     *   1. `_doWarmup()` catches per-backend probe throws and silently moves
     *      to the next candidate. Operators couldn't see WHICH backend won
     *      the probe race or why faster ones lost.
     *   2. `_dispatch()` returns `stubDetect()` when `_loadBackend()` returns
     *      null (dynamic-import failure). Silent.
     *   3. `_dispatch()` catches the backend's `detect()` throw and returns
     *      `stubDetect()`. Also silent.
     *
     * These four counters expose all three paths:
     *
     *   _warmupAttempts[backend]   — how many probe candidates we tried
     *   _warmupFailures[backend]   — probe attempts that threw / returned !ok
     *   _dispatchCount[backend]    — total scrub dispatches per backend
     *   _dispatchFailures[backend] — scrub dispatches that fell through to stub
     *                                (covers both load failure + detect throw)
     *
     * `_resetForTests()` resets all four. The counters are per-instance and
     * not persisted — they reflect the lifetime of the live singleton.
     */
    private _warmupAttempts: Record<Backend, number> = { webgpu: 0, wasm: 0, ollama: 0, stub: 0 };
    private _warmupFailures: Record<Backend, number> = { webgpu: 0, wasm: 0, ollama: 0, stub: 0 };
    private _dispatchCount: Record<Backend, number> = { webgpu: 0, wasm: 0, ollama: 0, stub: 0 };
    private _dispatchFailures: Record<Backend, number> = { webgpu: 0, wasm: 0, ollama: 0, stub: 0 };

    /**
     * Lazy-load weights / probe backends. Idempotent; subsequent calls share
     * the same in-flight promise.
     */
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
                // Backend loaded but its warmup() returned false — count as a
                // probe failure so operators see "wasm loaded but couldn't
                // warm up" without having to read backend logs.
                this._warmupFailures[candidate]++;
            } catch {
                this._warmupFailures[candidate]++;
                // try next
            }
        }
        // Stub always succeeds; redundant safety net.
        this.backend = 'stub';
        this.resolvedBackend = 'stub';
        this.readyFlag = true;
    }

    isReady(): boolean {
        return this.readyFlag;
    }

    /** Currently-active backend (after warmup). */
    activeBackend(): Backend {
        return this.backend;
    }

    /**
     * Scrub `text` for PII. Returns a {@link FilterReport}; the caller decides
     * what to do with `hardFail` (typically: refuse to publish upstream).
     *
     * Soft categories are always redacted in `redactedText`. Hard categories
     * are also redacted, plus they trip `hardFail`.
     *
     * Empty / non-string input returns a no-op report.
     */
    async scrub(text: string, opts?: ScrubOptions): Promise<FilterReport> {
        const startedAt = nowMs();
        const safeText = typeof text === 'string' ? text : '';
        if (!safeText) {
            return {
                detections: [],
                redactedText: safeText,
                hardFail: false,
                inferenceMs: 0,
                backend: this.backend,
            };
        }

        // Back-compat untagged path. Record an audit entry tagged
        // 'unspecified' so /debug/purpose can see how much untagged volume
        // remains while migration proceeds. Audit must never throw.
        // Stage 17 (Phase 4C): prefer kernel-mediated route; falls back to direct.
        if (!opts?.purpose) {
            void _privacyPurposeKernelCheck(
                {
                    purpose: 'unspecified',
                    capability: 'inference.privacy-scrub',
                    agentId: opts?.agentId,
                    dataCategories: [],
                },
                opts?.agentId,
            ).catch(() => {
                /* audit must never throw on the hot path */
            });
        }

        // Purpose-based policy gate. If the caller declared a purpose, run
        // the policy check + audit. A denial returns an empty hardFail
        // report — caller MUST refuse the upstream artifact. The actual PII
        // detection is skipped because the call wasn't authorized in the
        // first place.
        // Stage 17 (Phase 4C): prefer kernel-mediated route; falls back to direct.
        if (opts?.purpose) {
            const decision = await _privacyPurposeKernelCheck({
                purpose: opts.purpose,
                capability: 'inference.privacy-scrub',
                agentId: opts.agentId,
                dataCategories: ['pii.name', 'pii.email', 'pii.phone', 'pii.address'],
            }, opts.agentId);
            if (!decision.allowed) {
                // Deny-by-purpose: return EMPTY redactedText so callers that
                // log/display the field never see the raw input. Caller MUST
                // refuse the upstream artifact based on hardFail anyway.
                return {
                    detections: [],
                    redactedText: '',
                    hardFail: true,
                    inferenceMs: 0,
                    backend: this.backend,
                };
            }
        }

        const hardSet = new Set<PIICategory>(opts?.hardCategories ?? HARD_CATEGORIES);
        const softSet = new Set<PIICategory>(opts?.softCategories ?? SOFT_CATEGORIES);

        // Backend dispatch.
        let detections: PIIDetection[];
        let usedBackend: Backend = this.backend;

        if (opts?.forceBackend) {
            usedBackend = opts.forceBackend;
            detections = await this._dispatch(usedBackend, safeText);
        } else {
            // Lazy warmup on first call.
            if (!this.readyFlag) await this.warmup();
            usedBackend = this.backend;
            detections = await this._dispatch(usedBackend, safeText);
        }

        // Categories considered for hard fail / redaction. Anything outside the
        // union of hard ∪ soft is ignored entirely.
        //
        // Fictional-cast allowlist (fix/privacy-fictional-names, 2026-06):
        // `name` detections whose matched text is an explicitly allowlisted
        // story-internal name (opts.allowNames) are dropped BEFORE redaction /
        // hardFail so catalog fictional cast names survive the gate. This is
        // intentionally scoped to scene-render scrubs only. Other privacy
        // call sites ignore allowNames even if a caller supplies it.
        const allowNameSet = isSceneRenderPurpose(opts?.purpose)
            ? buildAllowNameSet(opts?.allowNames)
            : null;
        const considered = detections.filter((d) => {
            if (!hardSet.has(d.category) && !softSet.has(d.category)) return false;
            if (allowNameSet && d.category === 'name' && isAllowedName(d.text, allowNameSet)) {
                return false;
            }
            return true;
        });

        const redactedText = redact(safeText, considered);
        const hardFail = considered.some((d) => hardSet.has(d.category));

        return {
            detections: considered,
            redactedText,
            hardFail,
            inferenceMs: nowMs() - startedAt,
            backend: usedBackend,
        };
    }

    /**
     * Goal B (2026-05-22) — THE single canonical API for every private →
     * universal write.
     *
     * Spec: docs/superpowers/goals/2026-05-22-ag-goal-b-privacy-join-chokepoint.md
     *
     * Every cross-layer write (recipe publish, tip publish, claw ingest, free
     * text, voice answer, confession submit, agent prompt, IPFS upload,
     * pillar publish, etc.) MUST go through this chokepoint:
     *
     *   1. Assign a UUIDv4 `auditId` linkable to the resulting publish artifact.
     *   2. Hash the original payload (SHA-256) so the audit row carries proof
     *      of what was attempted without leaking content.
     *   3. Scrub the supplied `text` through the canonical PII gate.
     *   4. On HARD detection: reject — return `scrubbed: null`, mark
     *      `audit.allowed=false`, write to the cross-layer ring with
     *      `committedAt: null`. Caller MUST surface the rejection to the UI.
     *   5. On allow (clean OR SOFT-redacted): return the redacted text +
     *      `audit.allowed=true` + `committedAt = now`. Caller embeds the
     *      scrubbed text in the publish artifact alongside the auditId.
     *
     * The returned `auditId` is meant to ride along on the published artifact
     * (recipe payload, NFT metadata, P2P SkillNote, etc.) so the cross-layer
     * write is linkable back to the private-graph "I published X" event.
     */
    async publishToUniversal(
        opts: PublishToUniversalOptions,
    ): Promise<PublishToUniversalResult> {
        const submittedAt = Date.now();
        const auditId = this._mintUUID();
        const payloadHash = await this._hashPayload(opts.payload);
        const text = typeof opts.text === 'string' ? opts.text : '';

        // Most cross-layer purposes line up with the kernel `Purpose` enum
        // (recipe_publish / tip_publish / claw_ingest / voice_answer /
        // confession_submit / agent_prompt). A handful of audit-source values
        // (`other`, `lexicon_hint`, etc.) don't have a matching Purpose; for
        // those we skip the purpose-tagged policy check and rely on the
        // hard/soft category gate alone. Cast is intentional and narrowed
        // by the kernel's PurposeRegistry — unknown purposes fall through
        // to the back-compat untagged-scrub audit path inside `scrub()`.
        const KERNEL_PURPOSES = new Set<string>([
            'tip_drafting', 'recipe_matching', 'agent_prediction',
            'fact_extraction', 'banter_generation', 'observer_question',
            'prior_update', 'claw_ingest', 'tournament_judging', 'skill_match',
            'recipe_publish', 'asset_recipe_publish', 'ascii_video_publish',
            'tip_publish', 'tip_consume', 'free_text_input', 'voice_answer',
            'confession_submit', 'agent_prompt', 'memory_compact',
            'memory_consolidate', 'image_embed', 'text_embed', 'world_item_mint',
            'cross_world_hop', 'knowledge_publish', 'reaction_reward',
            'unspecified',
        ]);
        // Map audit-source values to kernel Purpose where the names diverge.
        const PURPOSE_ALIAS: Record<string, string> = {
            free_text: 'free_text_input',
        };
        const aliased = PURPOSE_ALIAS[opts.purpose as string] ?? (opts.purpose as string);
        const kernelPurpose = KERNEL_PURPOSES.has(aliased)
            ? (aliased as import('$lib/kernel-contracts/purpose/PurposeTypes').Purpose)
            : undefined;

        const report = await this.scrub(text, kernelPurpose ? { purpose: kernelPurpose } : undefined);

        const redactions: PrivacyRedaction[] = report.detections.map((d) => ({
            category: d.category,
            start: d.start,
            end: d.end,
            confidence: d.confidence,
        }));

        const allowed = !report.hardFail;
        const committedAt = allowed ? Date.now() : null;

        const audit: CrossLayerWriteAudit = {
            auditId,
            purpose: opts.purpose,
            submittedAt,
            committedAt,
            allowed,
            redactions,
            payloadHash,
            publishedTo: opts.publishedTo,
            callerName: opts.callerName,
        };

        try {
            privacyAuditService.recordCrossLayerWrite(audit);
        } catch (err) {
            // The audit log must never break the gate. Surface the warning so
            // misconfiguration is visible without taking down publish.
            console.warn(
                '[PrivacyFilterService.publishToUniversal] cross-layer audit record failed:',
                err,
            );
        }

        // Also write to the FilterReport ring so the legacy /debug/privacy
        // panel still shows the scrub event with its source tag. This keeps
        // the FilterReport surface complete after the migration.
        try {
            privacyAuditService.record({ source: opts.purpose, report });
        } catch {
            /* audit must never throw */
        }

        return {
            audit,
            scrubbed: allowed ? report.redactedText : null,
        };
    }

    // ── Goal B helpers ───────────────────────────────────────────────────

    private _mintUUID(): string {
        try {
            // Browser + Node ≥19 both ship globalThis.crypto.randomUUID.
            if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
                return globalThis.uuid();
            }
        } catch {
            /* fallthrough */
        }
        // Last-resort RFC4122-shaped fallback. Math.random is sufficient for an
        // audit-log key; collision risk inside a 5000-entry ring is negligible.
        const r = (n: number) =>
            Array.from({ length: n }, () =>
                Math.floor(Math.random() * 16).toString(16),
            ).join('');
        return `${r(8)}-${r(4)}-4${r(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${r(3)}-${r(12)}`;
    }

    private async _hashPayload(payload: unknown): Promise<string> {
        // Serialize deterministically. Plain JSON.stringify is enough for the
        // audit identity — keys come from the same call site each time.
        let serialized: string;
        try {
            serialized = typeof payload === 'string'
                ? payload
                : JSON.stringify(payload ?? null);
        } catch {
            serialized = String(payload);
        }

        try {
            if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
                const bytes = new TextEncoder().encode(serialized);
                const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
                const arr = new Uint8Array(buf);
                let hex = '';
                for (let i = 0; i < arr.length; i++) {
                    hex += arr[i].toString(16).padStart(2, '0');
                }
                return hex;
            }
        } catch {
            /* fallthrough to stable fallback */
        }

        // Fallback for environments without WebCrypto. NOT cryptographically
        // safe — but the audit hash is integrity-of-record, not authentication.
        // FNV-1a 64-bit (split into two 32-bit halves) hex-encoded.
        let h1 = 0x811c9dc5;
        let h2 = 0xcbf29ce4;
        for (let i = 0; i < serialized.length; i++) {
            const c = serialized.charCodeAt(i);
            h1 ^= c;
            h1 = Math.imul(h1, 0x01000193) >>> 0;
            h2 ^= c;
            h2 = Math.imul(h2, 0x100000001b3 >>> 0) >>> 0;
        }
        return (
            h1.toString(16).padStart(8, '0') +
            h2.toString(16).padStart(8, '0')
        ).padStart(64, '0');
    }

    // ── Backend dispatch ──

    private async _dispatch(backend: Backend, text: string): Promise<PIIDetection[]> {
        this._dispatchCount[backend]++;
        if (backend === 'stub') return stubDetect(text);
        const mod = await this._loadBackend(backend);
        if (!mod) {
            // Round-33: load failure counts as a dispatch failure (we asked
            // for `backend` but actually answered with stub).
            this._dispatchFailures[backend]++;
            return stubDetect(text);
        }
        try {
            return await mod.detect(text);
        } catch {
            this._dispatchFailures[backend]++;
            return stubDetect(text);
        }
    }

    /**
     * Lazy import of an alt backend. Returns null on import failure (which
     * causes auto-probe to skip the candidate). Cached after first attempt.
     */
    private async _loadBackend(backend: Backend): Promise<BackendModule | null> {
        if (backend === 'stub') {
            return {
                detect: async (t) => stubDetect(t),
                warmup: stubWarmup,
            };
        }
        if (backend in this.dynamicBackends) {
            return this.dynamicBackends[backend] ?? null;
        }
        try {
            if (backend === 'webgpu') {
                const m = await import('$lib/privacy/PrivacyFilterBackendWebGPU');
                const mod: BackendModule = {
                    detect: m.webgpuDetect,
                    warmup: m.webgpuWarmup,
                };
                this.dynamicBackends.webgpu = mod;
                return mod;
            }
            if (backend === 'wasm') {
                const m = await import('$lib/privacy/PrivacyFilterBackendWASM');
                const mod: BackendModule = {
                    detect: m.wasmDetect,
                    warmup: m.wasmWarmup,
                };
                this.dynamicBackends.wasm = mod;
                return mod;
            }
            if (backend === 'ollama') {
                const m = await import('$lib/privacy/PrivacyFilterBackendOllama');
                const mod: BackendModule = {
                    detect: m.ollamaDetect,
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

    /**
     * Round-33 — backend probe + dispatch counters snapshot.
     *
     * Operator-facing: powers a "PII gate health" panel on /debug/privacy
     * that surfaces (a) which backend won the probe race, (b) which probe
     * candidates failed, and (c) how often live scrubs silently fall back
     * to stub. Ratios like `dispatchFailures / dispatchCount` per backend
     * are the operator's "how broken is this backend?" signal.
     *
     * Pure read; safe to call from any surface.
     */
    getBackendStats(): {
        active: Backend;
        probeOrder: Backend[];
        warmup: Record<Backend, { attempts: number; failures: number }>;
        dispatch: Record<Backend, { count: number; failures: number; failureRate: number }>;
    } {
        const dispatch = {} as Record<Backend, { count: number; failures: number; failureRate: number }>;
        const warmup = {} as Record<Backend, { attempts: number; failures: number }>;
        const allBackends: Backend[] = ['webgpu', 'wasm', 'ollama', 'stub'];
        for (const b of allBackends) {
            const count = this._dispatchCount[b];
            const failures = this._dispatchFailures[b];
            dispatch[b] = {
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
            dispatch,
        };
    }

    /**
     * Round-33 — reset all backend probe + dispatch counters to zero.
     *
     * Independent of `clear()` on PrivacyAuditService — these counters live
     * with the filter service, not the audit ring. Operators use this from
     * /debug/privacy when investigating "did flipping a backend feature
     * flag actually take effect this session?"
     */
    clearBackendStats(): void {
        const allBackends: Backend[] = ['webgpu', 'wasm', 'ollama', 'stub'];
        for (const b of allBackends) {
            this._warmupAttempts[b] = 0;
            this._warmupFailures[b] = 0;
            this._dispatchCount[b] = 0;
            this._dispatchFailures[b] = 0;
        }
    }

    // ── Test helpers (not part of the public contract) ──

    /** Reset internal state — for tests only. Round-33: also clears stats. */
    _resetForTests(): void {
        this.backend = 'stub';
        this.resolvedBackend = null;
        this.warmupPromise = null;
        this.readyFlag = false;
        this.dynamicBackends = {};
        this.clearBackendStats();
    }

    /** Force the probe order — for tests only. */
    _setProbeOrderForTests(order: Backend[]): void {
        this.probeOrder = [...order];
    }

    /** Inject a mock backend for tests; bypasses `_loadBackend`. */
    _setBackendForTests(backend: Backend, mod: BackendModule | null): void {
        this.dynamicBackends[backend] = mod;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

/**
 * Replace each detection span in `text` with `[REDACTED:category]`. Detections
 * are assumed pre-deduped and sorted by start asc.
 */
function redact(text: string, detections: PIIDetection[]): string {
    if (detections.length === 0) return text;
    const sorted = [...detections].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    for (const d of sorted) {
        if (d.start < cursor) continue; // overlap safety; should not happen post-dedupe
        out += text.slice(cursor, d.start);
        out += `[REDACTED:${d.category}]`;
        cursor = d.end;
    }
    out += text.slice(cursor);
    return out;
}

/**
 * Normalize a caller-supplied `allowNames` list into a Set of trimmed,
 * non-empty names. Returns null when the list is absent/empty so the hot
 * path can skip the per-detection check entirely.
 */
function buildAllowNameSet(allowNames?: string[]): Set<string> | null {
    if (!Array.isArray(allowNames) || allowNames.length === 0) return null;
    const set = new Set<string>();
    for (const raw of allowNames) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (trimmed.length > 0) set.add(trimmed);
    }
    return set.size > 0 ? set : null;
}

function stripPossessive(token: string): string {
    return token.replace(/(?:'s|’s)$/u, '');
}

/**
 * A `name` detection is allowlisted only when the full matched span
 * (trimmed, possessive-stripped) equals an allowlisted name. Comparison is
 * case-sensitive — conservative by design: only exact literal fictional
 * catalog names pass through. Separate allowed tokens do not compose into a
 * new multi-word name.
 */
function isAllowedName(detectedText: string, allow: Set<string>): boolean {
    const span = stripPossessive(detectedText.trim());
    return allow.has(span);
}

function isSceneRenderPurpose(purpose: unknown): boolean {
    return purpose === 'scene_render';
}

// ── Singleton ────────────────────────────────────────────────────────────

export const privacyFilterService = new PrivacyFilterService();
