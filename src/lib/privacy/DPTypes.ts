// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\types\DPTypes.ts

/**
 * DPTypes — differential-privacy ledger primitives.
 *
 * Workstream B1 (Von Neumann Foundations, 2026-05-02). Catalogs every on-chain
 * published artifact, the noise mechanism applied, the per-publish ε cost, and
 * a running budget against a global cap. The intent is a sanity-checked, CI-
 * gated invariant that no publish path leaks more privacy than we have allotted.
 *
 * The five mechanisms enumerated below are the only categories the project
 * currently uses. Adding a new one is a deliberate design step, not a passing
 * change — the DP ledger needs to know how to compute ε for it.
 *
 *   - 'laplace':  Laplace-noise mechanism (sensitivity / scale → ε)
 *   - 'gaussian': Gaussian-noise mechanism (sensitivity / σ / δ → (ε, δ))
 *   - 'exponential': Exponential mechanism over a discrete output space
 *   - 'release-after-aggregation': k-anonymous release with no per-record noise
 *   - 'hash-only': Cryptographic-hash release that leaks no record information
 *                  (treated as ε=0 for accounting)
 */

export type DPMechanism =
    | 'laplace'
    | 'gaussian'
    | 'exponential'
    | 'release-after-aggregation'
    | 'hash-only';

/**
 * A registered artifact class — one row per "thing we publish".
 *
 * `name` is the canonical identifier (e.g. `recipeCommons.publishRecipe`).
 * `sensitivity` is the L1/L2 sensitivity of the underlying query.
 * `scaleParam` is mechanism-specific (Laplace `b`, Gaussian `σ`, exponential
 * sensitivity, k-aggregation threshold k, or unused for hash-only).
 * `epsilon` is the resulting ε per single publish call.
 */
export interface DPArtifact {
    name: string;
    mechanism: DPMechanism;
    sensitivity: number;
    scaleParam: number;
    epsilon: number;
    /** Optional δ for Gaussian/(ε,δ)-DP. */
    delta?: number;
    /** Free-form rationale: why this ε is acceptable for this artifact. */
    rationale?: string;
}

/** A budget-ledger entry: one artifact + total cumulative ε spent through it. */
export interface DPBudgetEntry {
    artifact: DPArtifact;
    spendCount: number;
    totalEpsilonSpent: number;
}

/** A single spend event — emitted whenever an artifact is published. */
export interface DPSpend {
    artifactName: string;
    sender: string;
    epsilon: number;
    timestamp: number;
}

/** Snapshot of the entire ledger at a point in time. */
export interface DPBudgetSnapshot {
    timestamp: number;
    totalEpsilonSpent: number;
    remainingBudget: number;
    cap: number;
    entries: DPBudgetEntry[];
    /** Per-sender breakdown of cumulative ε. */
    bySender: Record<string, number>;
    /** Recent spend tail (oldest → newest), bounded. */
    recentSpends: DPSpend[];
}

/** Budget-cap configuration. */
export interface DPLedgerConfig {
    totalEpsilonCap: number;
    /** Cap for the in-memory recent-spends ring buffer. */
    spendBufferSize?: number;
}

/** Sentinel — global default cap used when caller does not override. */
export const DEFAULT_TOTAL_EPSILON = 10;
