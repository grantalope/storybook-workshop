// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\DPBudgetLedger.ts

/**
 * DPBudgetLedger — runtime accounting for per-publish ε spend.
 *
 * Workstream B1 (Von Neumann Foundations, 2026-05-02). Companion to the
 * static {@link ../../tasks/dp-budget-catalog.md} catalog file: the catalog
 * names every publish call-site we know about and locks in its ε; this
 * service tracks the accumulated cost at runtime, refuses to let it exceed
 * the configured cap, and offers a snapshot for the operator console.
 *
 * Default cap is {@link DEFAULT_TOTAL_EPSILON}=10. Override via the
 * constructor when wiring up the singleton (e.g. for a tighter test budget).
 *
 * Ledger semantics:
 *   - {@link register} adds an artifact class. Re-registering the same name
 *     replaces the artifact spec; per-artifact spend totals are preserved.
 *   - {@link spend} records one publish event. Throws synchronously if the
 *     spend would push {@link totalSpent} past the cap.
 *   - {@link snapshot} returns a structural copy — safe to log / serialise.
 */

import type {
    DPArtifact,
    DPBudgetEntry,
    DPBudgetSnapshot,
    DPLedgerConfig,
    DPSpend,
} from '$lib/privacy/DPTypes';
import { DEFAULT_TOTAL_EPSILON } from '$lib/privacy/DPTypes';
import { optimalRDPOrder } from '$lib/privacy/RenyiDPAnalyzer';

const DEFAULT_BUFFER_SIZE = 500;

/**
 * Record of a single Gaussian mechanism that's been tracked through the RDP
 * accountant. We store (σ, Δ) per spend so {@link DPBudgetLedger.composedEpsilon}
 * can re-evaluate the optimal α at any δ on demand. Pre-conversion to ε would
 * lose information.
 */
interface RDPSpendRecord {
    artifactName: string;
    sigma: number;
    sensitivity: number;
    timestamp: number;
}

/** Thrown by {@link DPBudgetLedger.spend} when a spend would exceed the cap. */
export class DPBudgetExceededError extends Error {
    constructor(
        public readonly artifactName: string,
        public readonly attempted: number,
        public readonly remaining: number,
        public readonly cap: number,
    ) {
        super(
            `[DPBudgetLedger] spend on '${artifactName}' would exceed cap: ` +
                `attempted ε=${attempted.toFixed(4)} but remaining=${remaining.toFixed(4)} (cap=${cap}).`,
        );
        this.name = 'DPBudgetExceededError';
    }
}

/**
 * Round-40 — rejection + auto-register counters for DPBudgetLedger.
 *
 * Pre-round-40 the most operationally significant event in the DP budget
 * ledger — a `spend()` rejected for cap breach (throws
 * DPBudgetExceededError) — was invisible to operators. The throw escaped
 * to the caller (which had to handle gracefully) but the ledger itself
 * had no record of "we hit the cap N times this session" or "WHICH
 * artifacts hit the cap most often".
 *
 * Round-40 adds three lightweight counters that capture all the
 * notable side-effects of `spend()`:
 *
 *   _rejectedSpendsByArtifact[name] — count of DPBudgetExceededError throws,
 *                                     keyed by artifact name (so operators
 *                                     can identify the noisiest artifact)
 *   _autoRegisterCount              — count of implicit register() calls
 *                                     triggered by spend() on unknown
 *                                     artifact (catches "caller forgot to
 *                                     register" patterns)
 *   _invalidInputCount              — count of spend() throws on missing
 *                                     artifact.name / sender (programming
 *                                     bugs, distinct from cap rejection)
 *
 * Counters are per-instance, in-memory. Reset by {@link clearStats} —
 * does NOT reset the ε-spend totals (those are the load-bearing privacy
 * accounting and stay across stats resets).
 */
export interface DPBudgetRejectionStats {
    /** Total `spend()` calls rejected for cap breach, summed across artifacts. */
    totalRejectedSpends: number;
    /** Per-artifact rejection counts. Sparse — artifacts with 0 rejections omitted. */
    rejectedSpendsByArtifact: Record<string, number>;
    /** Total `spend()` calls that triggered an implicit register(). */
    autoRegisterCount: number;
    /** Total `spend()` calls that threw on missing artifact.name / sender. */
    invalidInputCount: number;
}

export class DPBudgetLedger {
    private readonly cap: number;
    private readonly bufferSize: number;
    private readonly entries: Map<string, DPBudgetEntry> = new Map();
    private readonly bySender: Map<string, number> = new Map();
    private readonly recentSpends: DPSpend[] = [];
    private cachedTotal = 0;
    /**
     * RDP-tracked spends. Populated only by {@link recordSpendRDP}; the basic
     * {@link spend} path stays untouched. Composed via Rényi DP accounting in
     * {@link composedEpsilon} for 10–100× tighter bounds than basic ε-summation.
     */
    private readonly rdpSpends: RDPSpendRecord[] = [];

    // ── Round-40 observability state ──────────────────────────────
    private _rejectedSpendsByArtifact: Map<string, number> = new Map();
    private _autoRegisterCount = 0;
    private _invalidInputCount = 0;

    constructor(config: DPLedgerConfig = { totalEpsilonCap: DEFAULT_TOTAL_EPSILON }) {
        this.cap = Number.isFinite(config.totalEpsilonCap) && config.totalEpsilonCap > 0
            ? config.totalEpsilonCap
            : DEFAULT_TOTAL_EPSILON;
        this.bufferSize = config.spendBufferSize ?? DEFAULT_BUFFER_SIZE;
    }

    /** Register a new artifact class (or replace an existing one's spec). */
    register(artifact: DPArtifact): void {
        if (!artifact || typeof artifact.name !== 'string' || artifact.name.length === 0) {
            throw new Error('[DPBudgetLedger] register: artifact.name is required');
        }
        if (!Number.isFinite(artifact.epsilon) || artifact.epsilon < 0) {
            throw new Error(
                `[DPBudgetLedger] register: artifact '${artifact.name}' has invalid ε=${artifact.epsilon}`,
            );
        }
        const existing = this.entries.get(artifact.name);
        if (existing) {
            // Preserve cumulative spend; just update spec.
            this.entries.set(artifact.name, {
                artifact: { ...artifact },
                spendCount: existing.spendCount,
                totalEpsilonSpent: existing.totalEpsilonSpent,
            });
            return;
        }
        this.entries.set(artifact.name, {
            artifact: { ...artifact },
            spendCount: 0,
            totalEpsilonSpent: 0,
        });
    }

    /** Record one publish event for `artifact` by `sender`. Throws on cap breach. */
    spend(artifact: DPArtifact, sender: string): DPSpend {
        if (!artifact || typeof artifact.name !== 'string') {
            this._invalidInputCount++;
            throw new Error('[DPBudgetLedger] spend: artifact.name is required');
        }
        if (typeof sender !== 'string' || sender.length === 0) {
            this._invalidInputCount++;
            throw new Error('[DPBudgetLedger] spend: sender is required');
        }

        // Ensure registered (auto-register if caller did not). This makes the
        // CI-script flow forgiving: a publish point that ships its own artifact
        // spec gets accounted even without an explicit register() call.
        if (!this.entries.has(artifact.name)) {
            this._autoRegisterCount++;
            this.register(artifact);
        }
        const entry = this.entries.get(artifact.name)!;
        const epsilon = entry.artifact.epsilon;

        const projectedTotal = this.cachedTotal + epsilon;
        if (projectedTotal > this.cap + 1e-9) {
            // Round-40: track per-artifact rejection counts so operators can
            // identify the noisiest budget-breacher.
            this._rejectedSpendsByArtifact.set(
                artifact.name,
                (this._rejectedSpendsByArtifact.get(artifact.name) ?? 0) + 1,
            );
            throw new DPBudgetExceededError(
                artifact.name,
                epsilon,
                this.cap - this.cachedTotal,
                this.cap,
            );
        }

        const spendEvent: DPSpend = {
            artifactName: artifact.name,
            sender,
            epsilon,
            timestamp: Date.now(),
        };

        entry.spendCount += 1;
        entry.totalEpsilonSpent += epsilon;
        this.cachedTotal = projectedTotal;
        this.bySender.set(sender, (this.bySender.get(sender) ?? 0) + epsilon);

        this.recentSpends.push(spendEvent);
        if (this.recentSpends.length > this.bufferSize) {
            this.recentSpends.splice(0, this.recentSpends.length - this.bufferSize);
        }

        return spendEvent;
    }

    /** Total ε spent across every artifact, every sender. */
    totalSpent(): number {
        return this.cachedTotal;
    }

    /** Remaining budget = cap − totalSpent. Always ≥ 0. */
    remainingBudget(): number {
        return Math.max(0, this.cap - this.cachedTotal);
    }

    /** Configured cap. */
    getCap(): number {
        return this.cap;
    }

    /** Look up one artifact entry (or undefined). */
    getEntry(artifactName: string): DPBudgetEntry | undefined {
        const entry = this.entries.get(artifactName);
        if (!entry) return undefined;
        return {
            artifact: { ...entry.artifact },
            spendCount: entry.spendCount,
            totalEpsilonSpent: entry.totalEpsilonSpent,
        };
    }

    /** All registered artifact names. */
    listArtifacts(): string[] {
        return Array.from(this.entries.keys()).sort();
    }

    /** Structural snapshot — safe to log/serialise. */
    snapshot(): DPBudgetSnapshot {
        const entries: DPBudgetEntry[] = [];
        for (const e of this.entries.values()) {
            entries.push({
                artifact: { ...e.artifact },
                spendCount: e.spendCount,
                totalEpsilonSpent: e.totalEpsilonSpent,
            });
        }
        entries.sort((a, b) => a.artifact.name.localeCompare(b.artifact.name));

        const bySender: Record<string, number> = {};
        for (const [sender, eps] of this.bySender.entries()) {
            bySender[sender] = eps;
        }

        return {
            timestamp: Date.now(),
            totalEpsilonSpent: this.cachedTotal,
            remainingBudget: this.remainingBudget(),
            cap: this.cap,
            entries,
            bySender,
            recentSpends: this.recentSpends.slice(),
        };
    }

    /**
     * Record a Gaussian-mechanism spend for RDP-based composition. Unlike
     * {@link spend}, this does NOT pre-convert to ε and does NOT charge the
     * basic-composition `cachedTotal` — RDP composes additively at a chosen α
     * and we want to defer the (ε,δ) conversion until {@link composedEpsilon}
     * is called (so we can search the optimal α at the caller's chosen δ).
     *
     * Use {@link spend} for the basic-composition fallback (existing call
     * sites). Use this method for new high-frequency Gaussian publish paths
     * that would saturate the basic-composition cap quickly.
     */
    recordSpendRDP(
        artifactName: string,
        sigma: number,
        sensitivity: number,
    ): void {
        if (typeof artifactName !== 'string' || artifactName.length === 0) {
            throw new Error('[DPBudgetLedger] recordSpendRDP: artifactName is required');
        }
        if (!Number.isFinite(sigma) || sigma <= 0) {
            throw new Error(
                `[DPBudgetLedger] recordSpendRDP: sigma must be positive (got ${sigma})`,
            );
        }
        if (!Number.isFinite(sensitivity) || sensitivity <= 0) {
            throw new Error(
                `[DPBudgetLedger] recordSpendRDP: sensitivity must be positive (got ${sensitivity})`,
            );
        }
        this.rdpSpends.push({
            artifactName,
            sigma,
            sensitivity,
            timestamp: Date.now(),
        });
    }

    /**
     * Composed (ε,δ)-DP across all RDP-tracked spends. Searches the standard α
     * grid for the tightest bound. Returns 0 if no RDP spends have been
     * recorded.
     *
     * The RDP totals do NOT include the basic-composition spends recorded via
     * {@link spend} — that path stays an independent ε counter. To get the
     * worst-case combined budget, sum {@link totalSpent} (basic) and this
     * method's return value.
     */
    composedEpsilon(delta = 1e-6): number {
        if (this.rdpSpends.length === 0) return 0;
        const sigmas = this.rdpSpends.map((r) => r.sigma);
        const sens = this.rdpSpends.map((r) => r.sensitivity);
        const { epsilon } = optimalRDPOrder(sigmas, sens, delta);
        return epsilon;
    }

    /** Number of RDP-tracked spends recorded. */
    rdpSpendCount(): number {
        return this.rdpSpends.length;
    }

    /** Reset spend totals to zero. Registrations are kept. Test-only convenience. */
    _resetForTests(): void {
        for (const e of this.entries.values()) {
            e.spendCount = 0;
            e.totalEpsilonSpent = 0;
        }
        this.bySender.clear();
        this.recentSpends.length = 0;
        this.cachedTotal = 0;
        this.rdpSpends.length = 0;
        // Round-40: also reset observability counters.
        this._rejectedSpendsByArtifact.clear();
        this._autoRegisterCount = 0;
        this._invalidInputCount = 0;
    }

    // ── Round-40 observability accessors ──────────────────────────

    /**
     * Round-40 — snapshot of cap-rejection + auto-register + invalid-input
     * counters. The ε-spend totals (already exposed by `snapshot()`) are
     * intentionally NOT reset by these counters' clear path — those are
     * the load-bearing privacy accounting.
     *
     * Pure projection. Safe to call from any surface.
     */
    getRejectionStats(): DPBudgetRejectionStats {
        const rejectedSpendsByArtifact: Record<string, number> = {};
        let totalRejectedSpends = 0;
        for (const [name, count] of this._rejectedSpendsByArtifact.entries()) {
            rejectedSpendsByArtifact[name] = count;
            totalRejectedSpends += count;
        }
        return {
            totalRejectedSpends,
            rejectedSpendsByArtifact,
            autoRegisterCount: this._autoRegisterCount,
            invalidInputCount: this._invalidInputCount,
        };
    }

    /**
     * Round-40 — reset just the rejection / auto-register / invalid-input
     * counters. Does NOT touch ε-spend totals (the load-bearing privacy
     * accounting). Operators use this from `/debug/privacy` after
     * investigating a spike.
     */
    clearStats(): void {
        this._rejectedSpendsByArtifact.clear();
        this._autoRegisterCount = 0;
        this._invalidInputCount = 0;
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

/** Default app-wide ledger. Wire to AppOrchestrator at boot. */
export const dpBudgetLedger = new DPBudgetLedger();
