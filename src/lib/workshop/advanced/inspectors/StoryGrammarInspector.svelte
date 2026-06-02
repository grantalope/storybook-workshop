<!--
  StoryGrammarInspector — always-visible at S6 in advanced mode.
  Renders Stein-Glenn 6 elements as a table (rows = beats, cols = elements)
  with pass/warn/fail glyphs. Click weak cell to suggest strengthening +
  trigger a per-beat redo.

  Goal Phase 5.

  Consumes GrammarValidationResult shape from author/types.
-->
<script lang="ts">
  import type {
    GrammarValidationResult,
    StoryGrammarElement,
    BeatId,
    BeatName,
  } from '$lib/services/author/types';
  import { BEAT_NAMES } from '$lib/services/author/types';

  export let result: GrammarValidationResult;
  export let onRedo: (beatId: BeatId, missing: StoryGrammarElement[]) => void = () => {};

  const BEATS: BeatId[] = [1, 2, 3, 4, 5, 6, 7];
  const ELEMENTS: StoryGrammarElement[] = [
    'setting',
    'initiating_event',
    'internal_response',
    'attempt',
    'consequence',
    'reaction',
  ];

  function cellStatus(beatId: BeatId, el: StoryGrammarElement): 'pass' | 'fail' {
    const gaps = result.beatGaps[beatId] ?? [];
    return gaps.includes(el) ? 'fail' : 'pass';
  }

  function passCount(beatId: BeatId): number {
    return ELEMENTS.length - (result.beatGaps[beatId]?.length ?? 0);
  }
</script>

<section class="inspector story-grammar-inspector" data-testid="story-grammar-inspector">
  <header>
    <h3>Story Grammar (Stein-Glenn)</h3>
    <span class="overall" class:passed={result.passed} data-testid="grammar-overall">
      {result.passed ? '✓ all elements present' : '✗ missing elements'}
    </span>
  </header>
  <table>
    <thead>
      <tr>
        <th>Beat</th>
        {#each ELEMENTS as el}
          <th>{el.replace(/_/g, ' ')}</th>
        {/each}
        <th>Score</th>
      </tr>
    </thead>
    <tbody>
      {#each BEATS as beatId}
        <tr data-testid="grammar-row-{beatId}">
          <td>
            <strong>{beatId}</strong>
            <span class="beat-name">{BEAT_NAMES[beatId]}</span>
          </td>
          {#each ELEMENTS as el}
            {@const status = cellStatus(beatId, el)}
            <td
              class="cell {status}"
              data-testid="grammar-cell-{beatId}-{el}"
            >
              {status === 'pass' ? '✓' : '✗'}
            </td>
          {/each}
          <td class="score">{passCount(beatId)}/{ELEMENTS.length}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !result.passed}
    <div class="redo-actions">
      {#each BEATS as beatId}
        {@const gaps = result.beatGaps[beatId] ?? []}
        {#if gaps.length > 0}
          <button
            type="button"
            on:click={() => onRedo(beatId, gaps)}
            data-testid="grammar-redo-{beatId}"
          >
            Redo beat {beatId} ({gaps.join(', ')})
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .inspector {
    padding: 0.75rem;
    border: 1px solid var(--ui-border, #ddd);
    border-radius: 0.5rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }
  header h3 { margin: 0; font-size: 0.95rem; }
  .overall { font-size: 0.75rem; color: var(--ui-warn, #c33); }
  .overall.passed { color: var(--ui-ok, #2a7); }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th, td { padding: 0.25rem; text-align: center; }
  th { border-bottom: 1px solid var(--ui-border, #ddd); font-weight: 600; }
  .cell.pass { color: var(--ui-ok, #2a7); }
  .cell.fail { color: var(--ui-warn, #c33); }
  .score { font-variant-numeric: tabular-nums; }
  .beat-name { font-size: 0.7rem; color: var(--ui-muted, #888); display: block; }
  .redo-actions {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .redo-actions button {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
  }
</style>
