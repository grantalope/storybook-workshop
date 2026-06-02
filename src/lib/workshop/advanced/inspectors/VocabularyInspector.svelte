<!--
  VocabularyInspector — always-visible at S6 in advanced mode.
  Lists each Tier-2 word with per-spread frequency map. Flags words appearing
  in < 2 contexts (Beck/McKeown spaced-exposure target).

  Goal Phase 6.
-->
<script lang="ts">
  import type { SceneTree, Tier2WordEntry } from '$lib/services/author/types';

  export let sceneTree: SceneTree;
  /** Optional vocab corpus entries to power definitions tooltip. */
  export let corpus: Tier2WordEntry[] = [];
  /** Spec target Tier-2 word count. */
  export let target: { min: number; max: number } = { min: 3, max: 5 };
  /** Spread-redo callback. */
  export let onRedo: (word: string, spreadIndex: number) => void = () => {};

  /**
   * Build a {word → {spreadIndex → count}} map by scanning spread_text in
   * the SceneTree. Case-insensitive whole-word match.
   */
  function buildFreqMap(): Map<string, Map<number, number>> {
    const map = new Map<string, Map<number, number>>();
    for (const word of sceneTree.tier2_words) {
      map.set(word, new Map());
      const re = new RegExp(`\\b${escapeRe(word)}\\b`, 'gi');
      for (const beat of sceneTree.beats) {
        for (const scene of beat.scenes) {
          for (const spread of scene.spreads) {
            const matches = (spread.spread_text || '').match(re);
            if (matches && matches.length > 0) {
              const inner = map.get(word)!;
              inner.set(spread.spreadIndex, (inner.get(spread.spreadIndex) ?? 0) + matches.length);
            }
          }
        }
      }
    }
    return map;
  }

  function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  $: freqMap = buildFreqMap();
  $: wordTotalContexts = (word: string) => freqMap.get(word)?.size ?? 0;
  $: tier2Count = sceneTree.tier2_words.length;
  $: targetMet = tier2Count >= target.min && tier2Count <= target.max;

  function defOf(word: string): string {
    const entry = corpus.find((e) => e.word.toLowerCase() === word.toLowerCase());
    return entry?.definition_kid ?? '';
  }
</script>

<section class="inspector vocabulary-inspector" data-testid="vocabulary-inspector">
  <header>
    <h3>Tier-2 Vocabulary</h3>
    <span
      class="target"
      class:met={targetMet}
      data-testid="vocab-target"
    >
      {tier2Count} of target {target.min}–{target.max}
    </span>
  </header>
  <table>
    <thead>
      <tr>
        <th>Word</th>
        <th>Contexts</th>
        <th>Spreads</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      {#each sceneTree.tier2_words as word}
        {@const contexts = wordTotalContexts(word)}
        {@const lowExposure = contexts < 2}
        <tr data-testid="vocab-row-{word}" class:low={lowExposure}>
          <td>
            <strong title={defOf(word)}>{word}</strong>
            {#if defOf(word)}<span class="def" data-testid="vocab-def-{word}">{defOf(word)}</span>{/if}
          </td>
          <td data-testid="vocab-context-count-{word}">{contexts}</td>
          <td>
            {#each Array.from(freqMap.get(word) ?? []) as [spreadIndex, count]}
              <span class="chip">#{spreadIndex} ×{count}</span>
            {/each}
          </td>
          <td>
            {#if lowExposure}
              <button
                type="button"
                on:click={() => onRedo(word, Array.from(freqMap.get(word) ?? [])[0]?.[0] ?? 0)}
                data-testid="vocab-redo-{word}"
              >
                Add another use
              </button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
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
  .target { font-size: 0.75rem; color: var(--ui-warn, #c33); }
  .target.met { color: var(--ui-ok, #2a7); }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th, td { padding: 0.25rem; text-align: left; }
  th { border-bottom: 1px solid var(--ui-border, #ddd); font-weight: 600; }
  tr.low { background: var(--ui-warn-bg, rgba(204, 51, 51, 0.06)); }
  .chip {
    display: inline-block;
    padding: 1px 6px;
    margin-right: 0.25rem;
    border-radius: 999px;
    background: var(--ui-card, #eee);
    font-size: 0.7rem;
  }
  .def { color: var(--ui-muted, #888); font-size: 0.7rem; display: block; }
</style>
