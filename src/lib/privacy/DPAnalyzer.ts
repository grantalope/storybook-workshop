// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\DPAnalyzer.ts

/**
 * DPAnalyzer — pure helpers for computing ε.
 *
 * Workstream B1 (Von Neumann Foundations, 2026-05-02). Stateless, side-effect-
 * free helpers used by {@link DPBudgetLedger} and the catalog seed list. Kept
 * separate so they can be unit-tested without touching the ledger.
 *
 *  - {@link epsilonForLaplace} — Laplace mechanism: ε = sensitivity / b
 *  - {@link epsilonForGaussian} — Gaussian mechanism: σ ≥ Δ·sqrt(2·ln(1.25/δ))/ε
 *                                  → ε = Δ·sqrt(2·ln(1.25/δ))/σ
 *  - {@link composeBasic} — basic composition: Σ εᵢ
 *  - {@link composeAdvanced} — advanced composition theorem (Dwork–Rothblum–Vadhan):
 *                              ε' = sqrt(2·k·ln(1/δ'))·ε_max + k·ε_max·(e^ε_max − 1)
 *                              for k homogeneous compositions; we generalise
 *                              by taking the max ε across the input list.
 */

/**
 * Laplace mechanism. Given query sensitivity Δ₁ and noise scale b > 0, the
 * Laplace mechanism is (Δ₁ / b)-DP. Returns 0 for non-positive scale (no
 * privacy loss is provable, but neither is any released signal — caller's
 * problem).
 */
export function epsilonForLaplace(sensitivity: number, scale: number): number {
    if (!Number.isFinite(sensitivity) || sensitivity <= 0) return 0;
    if (!Number.isFinite(scale) || scale <= 0) return Number.POSITIVE_INFINITY;
    return sensitivity / scale;
}

/**
 * Gaussian mechanism, parameterised by σ. The standard analytic bound (Dwork &
 * Roth, "Algorithmic Foundations of DP", Theorem A.1) gives
 *
 *     σ ≥ Δ₂ · sqrt(2·ln(1.25/δ)) / ε      ⇒    ε ≥ Δ₂ · sqrt(2·ln(1.25/δ)) / σ
 *
 * for δ < 1/2. We return the tightest ε given σ. For σ → 0 this returns ∞;
 * for δ ≥ 1 the formula degenerates and we return ∞ as well (caller likely
 * picked a bad δ).
 */
export function epsilonForGaussian(
    sensitivity: number,
    sigma: number,
    delta: number,
): number {
    if (!Number.isFinite(sensitivity) || sensitivity <= 0) return 0;
    if (!Number.isFinite(sigma) || sigma <= 0) return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
        return Number.POSITIVE_INFINITY;
    }
    return (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / sigma;
}

/**
 * Basic composition: ε_total = Σ εᵢ. Holds for arbitrary mechanisms run in
 * sequence, with no assumptions about adaptivity or homogeneity. Looser than
 * advanced composition for k > 5 with small individual εᵢ.
 */
export function composeBasic(epsilons: number[]): number {
    let sum = 0;
    for (const e of epsilons) {
        if (!Number.isFinite(e) || e < 0) {
            return Number.POSITIVE_INFINITY;
        }
        sum += e;
    }
    return sum;
}

/**
 * Advanced composition. Dwork, Rothblum & Vadhan ("Boosting and Differential
 * Privacy", FOCS 2010, Theorem III.3): the k-fold adaptive composition of
 * (ε, 0)-DP mechanisms is
 *
 *     ( sqrt(2·k·ln(1/δ'))·ε  +  k·ε·(e^ε − 1) ,  δ' )-DP
 *
 * for any δ' > 0. We apply it homogeneously by taking ε_max over the input
 * list (the standard reduction; the heterogeneous case is dominated by the
 * worst single term).
 *
 * Returns ∞ if δ ≤ 0 or any εᵢ is negative/non-finite. Returns 0 for an
 * empty list.
 */
export function composeAdvanced(epsilons: number[], delta: number): number {
    if (epsilons.length === 0) return 0;
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
        return Number.POSITIVE_INFINITY;
    }

    let eMax = 0;
    for (const e of epsilons) {
        if (!Number.isFinite(e) || e < 0) {
            return Number.POSITIVE_INFINITY;
        }
        if (e > eMax) eMax = e;
    }

    const k = epsilons.length;
    const term1 = Math.sqrt(2 * k * Math.log(1 / delta)) * eMax;
    const term2 = k * eMax * (Math.exp(eMax) - 1);
    return term1 + term2;
}

/**
 * Convenience: compute ε for an artifact by mechanism + parameters. Used by
 * the catalog seed list.
 */
export function epsilonForArtifact(
    mechanism:
        | 'laplace'
        | 'gaussian'
        | 'exponential'
        | 'release-after-aggregation'
        | 'hash-only',
    sensitivity: number,
    scaleParam: number,
    delta?: number,
): number {
    switch (mechanism) {
        case 'laplace':
            return epsilonForLaplace(sensitivity, scaleParam);
        case 'gaussian':
            return epsilonForGaussian(sensitivity, scaleParam, delta ?? 1e-6);
        case 'exponential':
            // Exponential mechanism: ε = 2·Δ·u_score / scaleParam (we treat
            // scaleParam as the inverse-utility-scale parameter the caller
            // chose). The conservative bound is 2·sensitivity / scaleParam.
            if (!Number.isFinite(scaleParam) || scaleParam <= 0) {
                return Number.POSITIVE_INFINITY;
            }
            return (2 * sensitivity) / scaleParam;
        case 'release-after-aggregation':
            // k-anonymous release with no per-record noise. Treated as ε=0
            // assuming k ≥ scaleParam (caller's responsibility); we annotate
            // this in the rationale field of the artifact.
            return 0;
        case 'hash-only':
            // SHA-256/keccak hashes leak no record information under the
            // random-oracle model. ε = 0 for accounting.
            return 0;
        default:
            return Number.POSITIVE_INFINITY;
    }
}
