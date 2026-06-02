<!--
  Station 5.5 — Render Direction.
  Per-beat text effect, palette accent; per-spread camera, lighting, pose,
  sidekick position. Persisted into AdvancedOverrideStore.

  Goal Phase 4.
-->
<script lang="ts">
  import { advancedOverrideStore } from '../services/AdvancedOverrideStore';
  import type {
    RenderDirection,
    PreTextEffectMode,
    PaletteAccent,
    CameraFraming,
    LightingDirection,
    PillarPose,
    SidekickPosition,
    PerBeatDirection,
    PerSpreadDirection,
  } from '../types';
  import type { BeatId } from '$lib/services/author/types';

  export let kidId: string;
  export let draftId: string;
  export let spreadCount: number = 16;
  export let initialRender: RenderDirection = {};
  export let onChange: (r: RenderDirection) => void = () => {};

  const BEATS: BeatId[] = [1, 2, 3, 4, 5, 6, 7];
  const EFFECTS: PreTextEffectMode[] = [
    'flow', 'bounce', 'wave', 'magnetic', 'glitch', 'dragon',
    'rise', 'scatter', 'orbit', 'gravity', 'vortex', 'parting-water',
  ];
  const PALETTES: PaletteAccent[] = [
    'warm-gold', 'cool-blue', 'cinematic-teal-orange', 'muted-pastels', 'vivid-primary',
  ];
  const CAMERAS: CameraFraming[] = [
    'establishing', 'pan', 'follow', 'tight-on-hero', 'reveal', 'wide-shot',
  ];
  const LIGHTINGS: LightingDirection[] = [
    'warm-front', 'cool-side', 'dramatic-back', 'golden-hour', 'moonlight', 'firelit',
  ];
  const POSES: PillarPose[] = [
    'sitting', 'running', 'reading', 'sleeping', 'dancing', 'climbing',
  ];
  const SIDEKICKS: SidekickPosition[] = ['left', 'right', 'behind', 'off-page-narrating'];

  function getBeat(beatId: BeatId): PerBeatDirection {
    return initialRender.perBeat?.find((b) => b.beatId === beatId) ?? { beatId };
  }
  function getSpread(spreadIndex: number): PerSpreadDirection {
    return initialRender.perSpread?.find((s) => s.spreadIndex === spreadIndex) ?? { spreadIndex };
  }

  const perBeat: PerBeatDirection[] = BEATS.map(getBeat);
  const perSpread: PerSpreadDirection[] = Array.from({ length: spreadCount }, (_, i) => getSpread(i));

  async function persist() {
    const render: RenderDirection = {
      perBeat: perBeat.filter((b) => b.textEffect !== undefined || b.paletteAccent !== undefined),
      perSpread: perSpread.filter(
        (s) =>
          s.camera !== undefined ||
          s.lighting !== undefined ||
          s.pillarPose !== undefined ||
          s.sidekickPosition !== undefined
      ),
    };
    await advancedOverrideStore.setRender(kidId, draftId, render);
    onChange(render);
  }
</script>

<section class="station station-5-5" data-testid="station-5-5-render-direction">
  <header>
    <h2>Station 5.5 — Render Direction</h2>
    <p class="subtitle">Per-beat typography + per-spread camera, lighting, pose.</p>
  </header>

  <div class="grid">
    <h3>Per-beat effect + palette</h3>
    <table>
      <thead>
        <tr><th>Beat</th><th>Text effect</th><th>Palette accent</th></tr>
      </thead>
      <tbody>
        {#each perBeat as beat (beat.beatId)}
          <tr data-testid="beat-row-{beat.beatId}">
            <td>{beat.beatId}</td>
            <td>
              <select bind:value={beat.textEffect} on:change={persist} data-testid="beat-effect-{beat.beatId}">
                <option value={undefined}>— auto —</option>
                {#each EFFECTS as e}
                  <option value={e}>{e}</option>
                {/each}
              </select>
            </td>
            <td>
              <select bind:value={beat.paletteAccent} on:change={persist} data-testid="beat-palette-{beat.beatId}">
                <option value={undefined}>— auto —</option>
                {#each PALETTES as p}
                  <option value={p}>{p}</option>
                {/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="grid">
    <h3>Per-spread camera + lighting + pose</h3>
    <table>
      <thead>
        <tr><th>Spread</th><th>Camera</th><th>Lighting</th><th>Pose</th><th>Sidekick</th></tr>
      </thead>
      <tbody>
        {#each perSpread as spread (spread.spreadIndex)}
          <tr data-testid="spread-row-{spread.spreadIndex}">
            <td>{spread.spreadIndex}</td>
            <td>
              <select bind:value={spread.camera} on:change={persist} data-testid="spread-camera-{spread.spreadIndex}">
                <option value={undefined}>— auto —</option>
                {#each CAMERAS as c}<option value={c}>{c}</option>{/each}
              </select>
            </td>
            <td>
              <select bind:value={spread.lighting} on:change={persist}>
                <option value={undefined}>— auto —</option>
                {#each LIGHTINGS as l}<option value={l}>{l}</option>{/each}
              </select>
            </td>
            <td>
              <select bind:value={spread.pillarPose} on:change={persist}>
                <option value={undefined}>— auto —</option>
                {#each POSES as p}<option value={p}>{p}</option>{/each}
              </select>
            </td>
            <td>
              <select bind:value={spread.sidekickPosition} on:change={persist}>
                <option value={undefined}>— auto —</option>
                {#each SIDEKICKS as s}<option value={s}>{s}</option>{/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .station {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .station header h2 { margin: 0 0 0.25rem; }
  .subtitle { color: var(--ui-muted, #888); margin: 0; font-size: 0.9rem; }
  .grid {
    padding: 0.75rem;
    border: 1px solid var(--ui-border, #ddd);
    border-radius: 0.5rem;
  }
  .grid h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; }
  th { border-bottom: 1px solid var(--ui-border, #ddd); font-weight: 600; }
  select { width: 100%; }
</style>
