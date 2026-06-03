// @graph-layer: private
// @rationale: private (env-var discipline; fail-closed in production)
//
// src/lib/env/production-config.ts
//
// Centralized check of the production env-var contract for the
// marketing-funnel subsystem (and adjacent surfaces). Read at boot via
// `assertProductionConfig()` to fail loudly on misconfigured deploys.
//
// Why this exists:
//  - The marketing-funnel HMAC + CRM + cron secret env vars MUST be set
//    in production. Each surface enforces this on first call, but a
//    boot-time scan surfaces the gap faster (deploy log instead of
//    first-user 503).
//
// See docs/production-deploy.md for the full env-var matrix.

interface EnvSnapshot {
	NODE_ENV?: string;
	VITEST?: string;
	VITEST_WORKER_ID?: string;
	STORYBOOK_EMAIL_GATE_SECRET?: string;
	CRON_SECRET?: string;
	RESEND_API_KEY?: string;
	POSTMARK_SERVER_TOKEN?: string;
	RESEND_FROM?: string;
	POSTMARK_FROM?: string;
}

function readEnv(): EnvSnapshot {
	return (typeof process !== 'undefined' ? process.env : {}) as EnvSnapshot;
}

export function isProduction(env: EnvSnapshot = readEnv()): boolean {
	const isVitest = Boolean(env.VITEST || env.VITEST_WORKER_ID);
	return env.NODE_ENV === 'production' && !isVitest;
}

export interface ProductionConfigReport {
	ok: boolean;
	missing: string[];
	warnings: string[];
}

/**
 * Inspect env and return a report. `ok=false` indicates at least one
 * REQUIRED env var is missing — caller should refuse to start.
 *
 * REQUIRED in production (NODE_ENV=production AND not vitest):
 *   - STORYBOOK_EMAIL_GATE_SECRET (>= 8 chars)
 *   - CRON_SECRET (>= 8 chars)
 *   - At least one of: RESEND_API_KEY OR POSTMARK_SERVER_TOKEN
 *
 * WARNINGS (production):
 *   - RESEND_FROM / POSTMARK_FROM not set — defaults are obvious dummies
 */
export function inspectProductionConfig(env: EnvSnapshot = readEnv()): ProductionConfigReport {
	const missing: string[] = [];
	const warnings: string[] = [];
	if (!isProduction(env)) {
		return { ok: true, missing: [], warnings: [] };
	}
	if (!env.STORYBOOK_EMAIL_GATE_SECRET || env.STORYBOOK_EMAIL_GATE_SECRET.length < 8) {
		missing.push('STORYBOOK_EMAIL_GATE_SECRET');
	}
	if (!env.CRON_SECRET || env.CRON_SECRET.length < 8) {
		missing.push('CRON_SECRET');
	}
	if (!env.RESEND_API_KEY && !env.POSTMARK_SERVER_TOKEN) {
		missing.push('RESEND_API_KEY|POSTMARK_SERVER_TOKEN');
	}
	if (env.RESEND_API_KEY && !env.RESEND_FROM) {
		warnings.push('RESEND_FROM unset — using noreply@storybook.example placeholder');
	}
	if (env.POSTMARK_SERVER_TOKEN && !env.POSTMARK_FROM) {
		warnings.push('POSTMARK_FROM unset — using noreply@storybook.example placeholder');
	}
	return { ok: missing.length === 0, missing, warnings };
}

/**
 * Throw if env is misconfigured for production. Call at boot in a
 * dedicated server-side hook (hooks.server.ts handle()) so the bad
 * deploy surfaces at startup, not on the first user request.
 */
export function assertProductionConfig(env: EnvSnapshot = readEnv()): void {
	const report = inspectProductionConfig(env);
	if (!report.ok) {
		throw new Error(
			'Production config invalid. Missing required env vars: ' +
				report.missing.join(', ') +
				'. See docs/production-deploy.md.',
		);
	}
	for (const w of report.warnings) {
		console.warn('[production-config]', w);
	}
}
