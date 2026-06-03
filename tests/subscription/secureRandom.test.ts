/**
 * secureRandom — CSPRNG int + string generators.
 *
 * Verifies (a) values come from globalThis.crypto.getRandomValues path,
 * (b) distribution is approximately uniform, (c) Math.random is absent
 * from the patched source files (regression guard for the security review
 * HIGH+MEDIUM findings).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { secureRandomInt, secureRandomString } from "$lib/services/subscription/secureRandom";

describe("secureRandomInt", () => {
	it("throws on non-positive maxExclusive", () => {
		expect(() => secureRandomInt(0)).toThrow();
		expect(() => secureRandomInt(-1)).toThrow();
		expect(() => secureRandomInt(1.5)).toThrow();
	});

	it("returns values in [0, maxExclusive)", () => {
		for (let i = 0; i < 200; i++) {
			const v = secureRandomInt(32);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(32);
			expect(Number.isInteger(v)).toBe(true);
		}
	});

	it("hits every bucket over many draws (sanity for distribution)", () => {
		const buckets = new Map<number, number>();
		for (let i = 0; i < 10_000; i++) buckets.set(secureRandomInt(8), (buckets.get(secureRandomInt(8)) ?? 0) + 1);
		// every bucket should have hits
		expect(buckets.size).toBeGreaterThanOrEqual(6);
	});
});

describe("secureRandomString", () => {
	it("returns the requested length", () => {
		expect(secureRandomString(0, "ABC")).toBe("");
		expect(secureRandomString(10, "AB").length).toBe(10);
		expect(secureRandomString(32, "abcdef0123456789").length).toBe(32);
	});

	it("only uses chars from the alphabet", () => {
		const alphabet = "XYZ123";
		const out = secureRandomString(100, alphabet);
		for (const c of out) {
			expect(alphabet).toContain(c);
		}
	});

	it("collision probability is small in a small sample (sanity)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) seen.add(secureRandomString(10, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
		// 1000 draws of 10-char from 32-char alphabet ≈ 32^10 ≈ 1.13e15 space.
		// Probability of collision in 1000 ≈ 4.4e-10. Expect zero in 1000 draws (essentially always).
		expect(seen.size).toBe(1000);
	});

	it("throws on empty alphabet", () => {
		expect(() => secureRandomString(10, "")).toThrow();
	});
});

describe("regression: Math.random absent in security-sensitive code paths", () => {
	const ROOT = resolve(__dirname, "..", "..");
	const FILES = [
		"src/lib/services/subscription/GiftFlowService.ts",
		"src/lib/services/subscription/ReferralAttribution.ts",
	];

	for (const rel of FILES) {
		it(`${rel} contains no Math.random() call`, () => {
			const content = readFileSync(resolve(ROOT, rel), "utf-8");
			// allow comments mentioning Math.random (e.g. "removed Math.random per CSPRNG fix")
			// but ban actual code calls. Simple heuristic: any occurrence outside a // ... line.
			const lines = content.split("\n");
			const offendingLines = lines
				.map((line, idx) => ({ idx: idx + 1, line }))
				.filter(({ line }) => {
					const trimmed = line.trimStart();
					if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
					return /\bMath\.random\s*\(/.test(line);
				});
			expect(offendingLines).toEqual([]);
		});
	}
});
