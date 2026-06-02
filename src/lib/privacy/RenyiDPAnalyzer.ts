// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\RenyiDPAnalyzer.ts

/**
 * RenyiDPAnalyzer — Rényi Differential Privacy (RDP) composition.
 *
 * Workstream B1 critique #4 (Von Neumann second-pass review, 2026-05-02). Modern
 * (ε,δ)-DP composition via Rényi DP gives 10–100× tighter bounds for repeated
 * mechanisms than the basic ε-summation in {@link DPAnalyzer.composeBasic} or
 * even the advanced composition theorem in {@link DPAnalyzer.composeAdvanced}.
 *
 * Headline win: 100 Gaussian publishes at σ=1.0, Δ=1.0 each compose to
 *   - basic:    ε = 100·5.297 ≈ 529.7
 *   - advanced: ε ≈ √(2·100·ln(1/δ))·5.297 + 100·5.297·(e^5.297−1) → astronomical
 *   - RDP:      ε ≈ 50 + log(1/δ)/(α−1) at optimal α — order-of-magnitude tighter.
 *
 * References:
 *   - Mironov, "Rényi Differential Privacy", CSF 2017 (the foundational paper).
 *   - Wang, Balle & Kasiviswanathan, "Subsampled Rényi DP and Analytical Moments
 *     Accountant", AISTATS 2019.
 *   - Abadi et al., "Deep Learning with Differential Privacy", CCS 2016 (the
 *     moments accountant approach that motivated RDP).
 *
 * Core formulas:
 *   - Gaussian RDP at order α:           α · Δ² / (2σ²)
 *   - RDP composes ADDITIVELY across mechanisms (independent of α).
 *   - RDP → (ε,δ)-DP conversion:         ε(δ) = RDP(α) + ln(1/δ)/(α−1)
 *
 * The optimal α minimises the conversion bound and depends on δ and total RDP.
 * We search a fixed grid; finer search is unnecessary for our use.
 *
 * Pure functions, no state.
 */

/**
 * Rényi DP at order α for the Gaussian mechanism with std-dev σ and L₂
 * sensitivity Δ. Closed form: RDP(α) = α · Δ² / (2σ²).
 *
 *  - Returns 0 for non-positive sensitivity or α ≤ 1 (degenerate; α must be > 1
 *    for RDP to be defined — α = 1 is KL divergence, handled separately and not
 *    needed by us).
 *  - Returns ∞ for σ ≤ 0.
 */
export function gaussianRDP(
    sigma: number,
    sensitivity: number,
    alpha: number,
): number {
    if (!Number.isFinite(sensitivity) || sensitivity <= 0) return 0;
    if (!Number.isFinite(alpha) || alpha <= 1) return 0;
    if (!Number.isFinite(sigma) || sigma <= 0) return Number.POSITIVE_INFINITY;
    return (alpha * sensitivity * sensitivity) / (2 * sigma * sigma);
}

/**
 * Compose RDP values from a sequence of mechanisms run in sequence (ALL at the
 * same α). RDP composes additively — that's the whole point of Rényi DP. The
 * caller is responsible for evaluating each mechanism's RDP at the same α
 * before passing to this function.
 *
 * Returns ∞ if any input is non-finite or negative.
 */
export function composeRDP(rdpValues: number[]): number {
    let sum = 0;
    for (const r of rdpValues) {
        if (!Number.isFinite(r) || r < 0) return Number.POSITIVE_INFINITY;
        sum += r;
    }
    return sum;
}

/**
 * Convert RDP at order α back to (ε,δ)-DP. Standard conversion (Mironov 2017
 * Proposition 3):
 *
 *     ε(δ) = RDP(α) + ln(1/δ) / (α − 1)
 *
 * The ln(1/δ)/(α−1) term grows as α → 1 and shrinks as α → ∞; meanwhile
 * RDP(α) typically grows linearly in α (e.g. Gaussian: α · Δ²/(2σ²)). The
 * sum has an interior optimum, which {@link optimalRDPOrder} finds by grid
 * search.
 */
export function rdpToDP(
    rdpValue: number,
    alpha: number,
    delta: number,
): number {
    if (!Number.isFinite(rdpValue) || rdpValue < 0) {
        return Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(alpha) || alpha <= 1) {
        return Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
        return Number.POSITIVE_INFINITY;
    }
    return rdpValue + Math.log(1 / delta) / (alpha - 1);
}

/**
 * Standard α grid for RDP optimisation. Covers small α (good when total RDP is
 * small and ln(1/δ)/(α−1) dominates) through large α (good for big batches
 * where the per-α RDP grows linearly but the conversion-correction shrinks).
 *
 * 13 points; fine enough that the optimum is within a few percent of the
 * continuous minimum without any iterative search.
 */
export const RDP_ALPHA_GRID: readonly number[] = [
    1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 16, 32, 64,
] as const;

/**
 * Find the α that minimises the (ε,δ) bound for a sequence of Gaussian
 * mechanisms. Searches {@link RDP_ALPHA_GRID}. Returns the best α and its
 * corresponding ε.
 *
 * Sigma and sensitivity arrays must have equal length; one entry per
 * mechanism in the composed sequence. For non-Gaussian mechanisms the
 * caller should pre-compute per-mechanism RDP at each α and call
 * {@link composeRDP} + {@link rdpToDP} directly.
 */
export function optimalRDPOrder(
    sigmas: number[],
    sensitivities: number[],
    delta: number,
): { alpha: number; epsilon: number } {
    if (sigmas.length !== sensitivities.length) {
        throw new Error(
            '[RenyiDPAnalyzer] optimalRDPOrder: sigmas and sensitivities must have equal length',
        );
    }
    if (sigmas.length === 0) return { alpha: 2, epsilon: 0 };
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
        return { alpha: 2, epsilon: Number.POSITIVE_INFINITY };
    }

    let bestAlpha = RDP_ALPHA_GRID[0]!;
    let bestEpsilon = Number.POSITIVE_INFINITY;

    for (const alpha of RDP_ALPHA_GRID) {
        let totalRDP = 0;
        let alphaIsBad = false;
        for (let i = 0; i < sigmas.length; i++) {
            const r = gaussianRDP(sigmas[i]!, sensitivities[i]!, alpha);
            if (!Number.isFinite(r)) {
                alphaIsBad = true;
                break;
            }
            totalRDP += r;
        }
        if (alphaIsBad) continue;
        const eps = rdpToDP(totalRDP, alpha, delta);
        if (eps < bestEpsilon) {
            bestEpsilon = eps;
            bestAlpha = alpha;
        }
    }

    return { alpha: bestAlpha, epsilon: bestEpsilon };
}
