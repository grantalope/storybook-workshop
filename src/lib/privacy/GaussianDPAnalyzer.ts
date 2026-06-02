// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\GaussianDPAnalyzer.ts

/**
 * GaussianDPAnalyzer — Gaussian DP / privacy-amplification helpers.
 *
 * Workstream B1 critique #4 (Von Neumann second-pass review, 2026-05-02).
 * Companion to {@link RenyiDPAnalyzer}: provides amplification-by-subsampling
 * (Mironov / Wang–Balle–Kasiviswanathan) and the central-limit-theorem style
 * approximation for many small mechanisms (Sommer–Meiser–Mohammadi 2019).
 *
 * Subsampled-Gaussian intuition: if you only see a fraction `q` of the data,
 * the privacy loss shrinks roughly by q². The exact bound (Mironov 2017,
 * Theorem 9, integer α version) is
 *
 *     RDP(α; q-subsampled Gaussian) ≤ (1/(α−1)) · ln(
 *         Σ_{k=0..α} C(α,k) · (1−q)^(α−k) · q^k · exp((k²−k)·Δ²/(2σ²))
 *     )
 *
 * for integer α ≥ 2. We implement this as the canonical bound. For non-integer
 * α we fall back to the simple multiplicative bound RDP_full · q² (a known
 * loose-but-correct upper envelope; tighter analytical-moments-accountant
 * bounds exist but require numerical integration we don't need today).
 *
 * CLT bound (Sommer–Meiser–Mohammadi, "Privacy Loss Classes", 2019): for many
 * small RDP values that are individually << 1, the composed (ε,δ)-DP scales
 * roughly as √(2·RDP_total·ln(1/δ)) — Gaussian-like even if individual
 * mechanisms are not Gaussian. This is a useful sanity-check approximation.
 *
 * Pure functions, no state.
 */

import { gaussianRDP } from '$lib/privacy/RenyiDPAnalyzer';

/**
 * Binomial coefficient C(n, k). Returns 0 for k < 0 or k > n. We use an
 * iterative product to avoid overflow on the integer α values we care about
 * (α ≤ 64). For α > 64 callers should fall through to the multiplicative
 * bound (which we do automatically when α is non-integer).
 */
function binomial(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    const kk = Math.min(k, n - k);
    let result = 1;
    for (let i = 0; i < kk; i++) {
        result = (result * (n - i)) / (i + 1);
    }
    return result;
}

/**
 * Subsampled-Gaussian RDP. Mironov's exact integer-α bound when α is a
 * positive integer ≥ 2; the multiplicative-q² fallback otherwise.
 *
 *  - sigma:        Gaussian noise std-dev
 *  - sensitivity:  L₂ sensitivity Δ
 *  - samplingRate: q ∈ (0, 1]; q = 1 means "no subsampling"
 *  - alpha:        Rényi order > 1
 *
 * Returns ∞ on bad inputs (q ≤ 0 or > 1, σ ≤ 0, α ≤ 1).
 */
export function subsampledGaussianRDP(
    sigma: number,
    sensitivity: number,
    samplingRate: number,
    alpha: number,
): number {
    if (!Number.isFinite(sensitivity) || sensitivity <= 0) return 0;
    if (!Number.isFinite(alpha) || alpha <= 1) return 0;
    if (!Number.isFinite(sigma) || sigma <= 0) return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(samplingRate) || samplingRate <= 0 || samplingRate > 1) {
        return Number.POSITIVE_INFINITY;
    }
    if (samplingRate === 1) {
        return gaussianRDP(sigma, sensitivity, alpha);
    }

    const isIntegerAlpha =
        Number.isInteger(alpha) && alpha >= 2 && alpha <= 64;
    if (!isIntegerAlpha) {
        // Multiplicative-q² envelope. Loose but correct upper bound; tighter
        // analytical-moments accounting requires numerical integration we
        // don't need at the moment.
        const baseRDP = gaussianRDP(sigma, sensitivity, alpha);
        return baseRDP * samplingRate * samplingRate;
    }

    // Mironov 2017, Theorem 9. For integer α ≥ 2:
    //   RDP(α) ≤ (1/(α−1)) · ln( Σ_{k=0..α} C(α,k)·(1−q)^(α−k)·q^k · exp((k²−k)·Δ²/(2σ²)) )
    const aInt = alpha;
    const sigmaSq2 = 2 * sigma * sigma;
    const dSq = sensitivity * sensitivity;
    let sum = 0;
    for (let k = 0; k <= aInt; k++) {
        const coef = binomial(aInt, k);
        const probTerm = Math.pow(1 - samplingRate, aInt - k) * Math.pow(samplingRate, k);
        const expTerm = Math.exp(((k * k - k) * dSq) / sigmaSq2);
        sum += coef * probTerm * expTerm;
    }
    if (!Number.isFinite(sum) || sum <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.log(sum) / (aInt - 1);
}

/**
 * CLT-style (ε,δ)-DP bound from a list of small per-mechanism RDP values.
 * Sommer–Meiser–Mohammadi 2019: for many small RDP_i, the privacy loss
 * random variable converges to a Gaussian and the (ε,δ)-DP bound is
 * approximately
 *
 *     ε(δ) ≈ √(2 · Σ RDP_i · ln(1/δ))
 *
 * This is a simple, useful sanity check. It is asymptotically tight in the
 * many-small-mechanisms regime. For exact bounds, prefer
 * {@link RenyiDPAnalyzer.optimalRDPOrder} which searches α explicitly.
 *
 * Returns 0 for an empty input list, ∞ on bad δ.
 */
export function centralLimitDP(rdpValues: number[], delta: number): number {
    if (rdpValues.length === 0) return 0;
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1) {
        return Number.POSITIVE_INFINITY;
    }
    let total = 0;
    for (const r of rdpValues) {
        if (!Number.isFinite(r) || r < 0) return Number.POSITIVE_INFINITY;
        total += r;
    }
    return Math.sqrt(2 * total * Math.log(1 / delta));
}
