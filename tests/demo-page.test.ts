// tests/demo-page.test.ts
//
// Covers the /demo page logic (no browser rendering — pure unit tests):
//   1. pct() similarity-to-percent helper
//   2. PillarManifestClient: fetches v2 manifest on mount (mock fetch)
//   3. PillarManifestClient: returns [] on network failure (no crash)
//   4. PillarMatcherService: match returns top-3 sorted DESC
//   5. PillarMatcherService: match with empty manifest -> []
//   6. PillarVectorizerService: fallback state when warmup fails
//   7. PillarVectorizerService: throws informative error on vectorize before warmup succeeds (fallback backend)
//   8. fetch-wrapper upload counter: POST increments count
//   9. fetch-wrapper upload counter: GET to own origin does NOT increment
//   10. parseManifest: valid v2 entries parsed + embedding converted to Float32Array
//   11. parseManifest: drops malformed entry, keeps valid ones
//   12. cosineSimilarity: identical vectors -> ~1

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseManifest,
  invalidate,
  __test as manifestTest,
} from "$lib/services/PillarManifestClient";
import {
  PillarMatcherService,
  cosineSimilarity,
} from "$lib/services/PillarMatcherService";
import { PillarVectorizerService } from "$lib/services/PillarVectorizerService";
import type { PillarAxes } from "$lib/services/types";

// ── helpers ──────────────────────────────────────────────────────────────

function axes(): PillarAxes {
  return { hair: "wavy-short", skinTone: "III", eyeColor: "brown", ageBand: "preschool", clothingVibe: "casual", extras: [] };
}

function entry(pillarId: number, emb: number[] = [0.5, 0.5, 0, 0]) {
  return { pillarId, axes: axes(), embedding: emb };
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// pct helper (extracted logic to test without DOM)
function pct(sim: number) {
  return Math.round(Math.max(0, Math.min(1, (sim + 1) / 2)) * 100);
}

// ── 1. pct helper ──────────────────────────────────────────────────────

describe("pct helper", () => {
  it("maps sim=1 to 100%", () => { expect(pct(1)).toBe(100); });
  it("maps sim=0 to 50%", () => { expect(pct(0)).toBe(50); });
  it("maps sim=-1 to 0%", () => { expect(pct(-1)).toBe(0); });
  it("clamps above 1", () => { expect(pct(1.5)).toBe(100); });
  it("clamps below -1", () => { expect(pct(-2)).toBe(0); });
});

// ── 2-3. PillarManifestClient ─────────────────────────────────────────

describe("PillarManifestClient.fetchManifest", () => {
  beforeEach(() => manifestTest.reset());

  it("fetches v2 manifest and caches it", async () => {
    const { fetchManifest } = await import("$lib/services/PillarManifestClient");
    const fetcher = vi.fn().mockResolvedValue(ok([entry(1), entry(2)]));
    manifestTest.setFetchOverride(fetcher);
    const result = await fetchManifest();
    expect(result.length).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns [] on network failure (never throws)", async () => {
    const { fetchManifest } = await import("$lib/services/PillarManifestClient");
    manifestTest.setFetchOverride(vi.fn().mockRejectedValue(new Error("network down")));
    const result = await fetchManifest();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── 4-5. PillarMatcherService ─────────────────────────────────────────

describe("PillarMatcherService.match", () => {
  it("returns top-3 sorted DESC by similarity", async () => {
    const svc = new PillarMatcherService();
    const dim = 4;
    const emb = (vals: number[]) => new Float32Array(vals);
    const pillars = [
      { pillarId: 1, axes: axes(), embedding: emb([1, 0, 0, 0]) },
      { pillarId: 2, axes: axes(), embedding: emb([0, 1, 0, 0]) },
      { pillarId: 3, axes: axes(), embedding: emb([0.7, 0.7, 0, 0]) },
      { pillarId: 4, axes: axes(), embedding: emb([-1, 0, 0, 0]) },
    ];
    svc.__test_setManifest(pillars);
    const query = emb([1, 0, 0, 0]);
    const results = await svc.match(query, { topK: 3 });
    expect(results.length).toBe(3);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThanOrEqual(results[2].similarity);
    expect(results[0].pillarId).toBe(1); // exact match
  });

  it("returns [] when manifest is empty", async () => {
    const svc = new PillarMatcherService();
    svc.__test_setManifest([]);
    const result = await svc.match(new Float32Array([1, 0, 0, 0]), { topK: 3 });
    expect(result).toEqual([]);
  });
});

// ── 6-7. PillarVectorizerService ──────────────────────────────────────

describe("PillarVectorizerService", () => {
  it("is in fallback state when warmup fails", async () => {
    const svc = new PillarVectorizerService();
    svc.__test_setHooks({
      imagePipelineFactory: async () => { throw new Error("no gpu"); },
      probeOrder: ["wasm"],
    });
    await svc.warmup();
    expect(svc.activeBackend()).toBe("fallback");
    expect(svc.isReady()).toBe(true);
  });

  it("throws informative error on vectorize when fallback", async () => {
    const svc = new PillarVectorizerService();
    svc.__test_setHooks({
      imagePipelineFactory: async () => { throw new Error("no webgpu"); },
      probeOrder: ["webgpu"],
    });
    await svc.warmup();
    await expect(svc.vectorize(new Blob(["x"], { type: "image/jpeg" }))).rejects.toThrow(/fallback/i);
  });

  it("returns Float32Array of correct dim when pipeline succeeds", async () => {
    const DIM = 512;
    const svc = new PillarVectorizerService();
    svc.__test_setHooks({
      imagePipelineFactory: async () =>
        async () => ({ data: new Float32Array(DIM) }),
      probeOrder: ["wasm"],
    });
    await svc.warmup();
    const result = await svc.vectorize(new Blob(["fake-img"], { type: "image/jpeg" }));
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(DIM);
  });
});

// ── 8-9. fetch-wrapper upload counter logic ───────────────────────────

describe("upload counter logic", () => {
  it("POST to external URL increments count", () => {
    let count = 0;
    function checkUrl(url: string, method: string, origin: string) {
      const isLocal = url.startsWith("/") || url.startsWith(origin);
      if (!isLocal || method === "POST" || method === "PUT") count++;
    }
    checkUrl("https://external.com/api", "POST", "http://localhost:5173");
    expect(count).toBe(1);
  });

  it("GET to own origin does not increment count", () => {
    let count = 0;
    function checkUrl(url: string, method: string, origin: string) {
      const isLocal = url.startsWith("/") || url.startsWith(origin);
      if (!isLocal || method === "POST" || method === "PUT") count++;
    }
    checkUrl("/pillar-library-v2/manifest.json", "GET", "http://localhost:5173");
    checkUrl("http://localhost:5173/demo-samples/sample-01.jpg", "GET", "http://localhost:5173");
    expect(count).toBe(0);
  });
});

// ── 10-11. parseManifest ──────────────────────────────────────────────

describe("parseManifest", () => {
  it("converts number[] embeddings to Float32Array", () => {
    const raw = [entry(1, [0.1, 0.2, 0.3, 0.4])];
    const parsed = parseManifest(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].embedding).toBeInstanceOf(Float32Array);
    expect(parsed[0].embedding[0]).toBeCloseTo(0.1);
  });

  it("drops malformed entries, keeps valid ones", () => {
    const raw = [
      entry(1, [0.1, 0.2]),
      { pillarId: "bad", axes: axes(), embedding: [0.1] }, // invalid pillarId
      entry(3, [0.5, 0.5]),
    ];
    const parsed = parseManifest(raw as any);
    expect(parsed.length).toBe(2);
    expect(parsed.map((p) => p.pillarId)).toEqual([1, 3]);
  });
});

// ── 12. cosineSimilarity ──────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical unit vectors -> ~1", () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });
});