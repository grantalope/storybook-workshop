// e2e/storybook-workshop-pretext.spec.ts
//
// Storybook Workshop — Phase 9 Playwright smoke for the BookSpreadSurfaceAdapter
// pipeline + StaticFrameExporter + BookSpreadCanvas live-animation hooks.
//
// Smoke flow (browser env where animation frame + Canvas2D APIs are real):
//   1. Boot a /dashboard/ page so SvelteKit module graph is live.
//   2. Inside page.evaluate, dynamic-import the render barrel + exercise
//      compose(), capturePeakFrame, ehri+effect maps. Assert shapes match
//      what the static unit tests cover, in a real browser realm.
//   3. Verify the focal-point obstacle bbox does not overlap the prose
//      origin (text-flow invariant for §3.8).
//   4. Verify a default-stub PNG blob is produced and has non-zero size
//      under DPI=300 + DPI=72 settings.
//
// Tolerant: if no dev server is reachable on the well-known ports we
// gracefully skip the test rather than fail CI in environments without
// a running vite. Matches the pattern used by e2e/recipe-subscriptions.spec.ts.

import { test, expect, type Page } from '@playwright/test';

const CANDIDATE_PORTS = [5298, 5297, 5295, 5293, 5191, 5184, 5183, 5180, 5173, 5174];

async function findBaseUrl(page: Page): Promise<string | null> {
  const envUrl = process.env.GOLDEN_BASE_URL;
  if (envUrl) {
    try {
      const res = await page.request.get(`${envUrl}/dashboard/`, { timeout: 4_000 });
      if (res.status() < 500) return envUrl;
    } catch { /* fall through */ }
  }
  for (const port of CANDIDATE_PORTS) {
    for (const host of ['localhost', '127.0.0.1']) {
      const url = `http://${host}:${port}/dashboard/`;
      try {
        const res = await page.request.get(url, { timeout: 4_000 });
        if (res.status() < 500) return `http://${host}:${port}`;
      } catch { /* try next */ }
    }
  }
  return null;
}

test.describe('Storybook Workshop — BookSpreadSurfaceAdapter pretext smoke', () => {
  test.setTimeout(120_000);

  test('composite produces focal obstacle + prose + dialogic in browser realm', async ({ page }) => {
    const baseURL = await findBaseUrl(page);
    test.skip(!baseURL, 'no reachable dev server');
    await page.goto(`${baseURL}/dashboard/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('/src/routes/dashboard/services/storybook-workshop/render/index.ts');
      const out = mod.composeBookSpread({
        spread: {
          spreadIndex: 0,
          text: 'In the garden the dragon learned to whisper.',
          tier2Words: ['whisper'],
          dialogicPrompts: [{ id: 'q1', kind: 'open', text: 'What might happen next?' }],
        },
        beat: { id: 'setup' },
        sceneFocal: { x: 360, y: 270, radius: 80 },
        ehriPhase: 'partial-alphabetic',
        spreadBounds: { x: 0, y: 0, width: 720, height: 540 },
        opts: {
          scenePngWidth: 720, scenePngHeight: 540, dpi: 300,
          easierReadingMode: false, dialogicPromptsEnabled: true,
        },
      });
      return {
        effect: out.effect,
        elementTypes: out.elements.map((e: { type: string }) => e.type),
        emphasisKeyCount: Object.keys(out.emphasis).length,
      };
    });

    expect(result.effect).toBe('flow');
    expect(result.elementTypes).toContain('grid');
    expect(result.elementTypes).toContain('prose');
    expect(result.elementTypes).toContain('speech');
    expect(result.emphasisKeyCount).toBeGreaterThan(0);
  });

  test('focal-point obstacle does not overlap prose origin', async ({ page }) => {
    const baseURL = await findBaseUrl(page);
    test.skip(!baseURL, 'no reachable dev server');
    await page.goto(`${baseURL}/dashboard/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const overlap = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('/src/routes/dashboard/services/storybook-workshop/render/index.ts');
      const out = mod.composeBookSpread({
        spread: { spreadIndex: 1, text: 'A small fox crept past.', tier2Words: [], dialogicPrompts: [] },
        beat: { id: 'catalyst' },
        sceneFocal: { x: 600, y: 300, radius: 50 },
        ehriPhase: 'full-alphabetic',
        spreadBounds: { x: 0, y: 0, width: 720, height: 540 },
        opts: { scenePngWidth: 720, scenePngHeight: 540, dpi: 72, easierReadingMode: false, dialogicPromptsEnabled: false },
      });
      const focal = out.elements.find((e: { type: string }) => e.type === 'grid');
      const prose = out.elements.find((e: { type: string }) => e.type === 'prose');
      if (!focal || !prose) return null;
      const overlap =
        prose.origin.x >= focal.bounds.x &&
        prose.origin.x <= focal.bounds.x + focal.bounds.width &&
        prose.origin.y >= focal.bounds.y &&
        prose.origin.y <= focal.bounds.y + focal.bounds.height;
      return { overlap };
    });

    expect(overlap).not.toBeNull();
    expect(overlap?.overlap).toBe(false);
  });

  test('StaticFrameExporter returns a non-empty PNG blob at 300 dpi', async ({ page }) => {
    const baseURL = await findBaseUrl(page);
    test.skip(!baseURL, 'no reachable dev server');
    await page.goto(`${baseURL}/dashboard/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const blobInfo = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('/src/routes/dashboard/services/storybook-workshop/render/index.ts');
      const composite = mod.composeBookSpread({
        spread: { spreadIndex: 2, text: 'Sunset fell over the valley.', tier2Words: ['valley'], dialogicPrompts: [] },
        beat: { id: 'climax' },
        sceneFocal: { x: 100, y: 100, radius: 50 },
        ehriPhase: 'consolidated-alphabetic',
        spreadBounds: { x: 0, y: 0, width: 720, height: 540 },
        opts: { scenePngWidth: 720, scenePngHeight: 540, dpi: 300, easierReadingMode: true, dialogicPromptsEnabled: false },
      });
      const out = await mod.capturePeakFrame(composite, 1000, {
        widthPx: 320, heightPx: 240, dpi: 300,
      });
      return { size: out.blob.size, type: out.blob.type, capturedAtMs: out.capturedAtMs };
    });

    expect(blobInfo.size).toBeGreaterThan(0);
    expect(blobInfo.type).toBe('image/png');
    // dragon peak fraction = 0.75 × 1000 = 750
    expect(blobInfo.capturedAtMs).toBe(750);
  });

  test('overrideEffect applies advanced-mode beat-effect override', async ({ page }) => {
    const baseURL = await findBaseUrl(page);
    test.skip(!baseURL, 'no reachable dev server');
    await page.goto(`${baseURL}/dashboard/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const effect = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('/src/routes/dashboard/services/storybook-workshop/render/index.ts');
      const out = mod.composeBookSpread({
        spread: { spreadIndex: 3, text: 't', tier2Words: [], dialogicPrompts: [] },
        beat: { id: 'climax' },
        sceneFocal: { x: 10, y: 10, radius: 5 },
        ehriPhase: 'full-alphabetic',
        spreadBounds: { x: 0, y: 0, width: 200, height: 200 },
        opts: { scenePngWidth: 200, scenePngHeight: 200, dpi: 72, easierReadingMode: false, dialogicPromptsEnabled: false },
        effectOverride: 'vortex',
      });
      return out.effect;
    });

    expect(effect).toBe('vortex');
  });
});
