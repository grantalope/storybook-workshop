/**
 * kids-content-safety-globalthis-wiring.test.ts
 *
 * Regression test for P0 finding: Kids content safety gate never wired —
 * all LLM story text passes permissive stub.
 *
 * Verifies:
 *   1. Importing KidsContentSafetyService sets globalThis.__kidsContentSafetyService.
 *   2. The wired value is NOT the permissive stub.
 *   3. The adapter blocks violence-keyword text (gate fires).
 *   4. The adapter passes neutral kid-book prose (no false positives).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { kidsContentSafetyService } from "$lib/kids-content-safety";
import type { KidsContentSafetyLike } from "$lib/services/author/StoryAuthorService";

beforeEach(() => {
    kidsContentSafetyService._resetForTests();
    kidsContentSafetyService._setProbeOrderForTests(["stub"]);
});

afterEach(() => {
    kidsContentSafetyService._resetForTests();
});

describe("globalThis.__kidsContentSafetyService wiring", () => {
    it("is set after importing KidsContentSafetyService", () => {
        const slot = (globalThis as Record<string, unknown>).__kidsContentSafetyService;
        expect(slot).toBeDefined();
        expect(typeof (slot as any)?.scan).toBe("function");
    });

    it("blocks a violence-keyword text — NOT the permissive stub", async () => {
        const slot = (globalThis as Record<string, unknown>).__kidsContentSafetyService as KidsContentSafetyLike;
        const result = await slot.scan("The villain killed the hero with a knife.");
        expect(result.passed).toBe(false);
        expect(result.categories.length).toBeGreaterThan(0);
    });

    it("passes neutral kid-book prose", async () => {
        const slot = (globalThis as Record<string, unknown>).__kidsContentSafetyService as KidsContentSafetyLike;
        const result = await slot.scan("The little bear found a red balloon in the tall grass.");
        expect(result.passed).toBe(true);
        expect(result.categories).toEqual([]);
    });

    it("confidence is a non-zero number on a keyword hit", async () => {
        const slot = (globalThis as Record<string, unknown>).__kidsContentSafetyService as KidsContentSafetyLike;
        const result = await slot.scan("The soldier shot and killed the prisoner.");
        expect(typeof result.confidence).toBe("number");
        expect(result.confidence).toBeGreaterThan(0);
    });
});

describe("Gate correctness — real gate vs permissive stub contrast", () => {
    it("the old permissive stub passes violence text (demonstrates the bug)", async () => {
        const stub: KidsContentSafetyLike = {
            async scan(_text: string) {
                return { passed: true, categories: [], confidence: 0 };
            },
        };
        const r = await stub.scan("The killer stabbed the boy.");
        expect(r.passed).toBe(true);
    });

    it("the wired globalThis slot blocks violence text (demonstrates the fix)", async () => {
        const slot = (globalThis as Record<string, unknown>).__kidsContentSafetyService as KidsContentSafetyLike;
        const r = await slot.scan("The killer stabbed the boy.");
        expect(r.passed).toBe(false);
        expect(r.categories).toContain("violence");
    });
});
