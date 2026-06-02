<!--
  Station 1.5 — Pedagogy Override.
  10 evidence-knobs as direct controls, each with its peer-reviewed citation
  rendered beneath. Persists into AdvancedOverrideStore per (kidId, draftId).

  Goal Phase 2.
-->
<script lang="ts">
  import { PEDAGOGY_CITATIONS } from '../PedagogyCitations';
  import { advancedOverrideStore } from '../services/AdvancedOverrideStore';
  import type {
    PedagogyOverride,
    FontChoice,
    DialogicPromptDensity,
    StoryGrammarEnforcement,
  } from '../types';
  import type { EhriPhase } from '$lib/services/author/types';

  export let kidId: string;
  export let draftId: string;
  export let initialOverride: PedagogyOverride = {};
  export let onChange: (o: PedagogyOverride) => void = () => {};

  let ped: PedagogyOverride = { ...initialOverride };

  const EHRI_PHASES: EhriPhase[] = [
    'pre-alphabetic',
    'partial-alphabetic',
    'full-alphabetic',
    'consolidated-alphabetic',
  ];
  const DENSITIES: DialogicPromptDensity[] = ['dense', 'sparse', 'off'];
  const ENFORCEMENTS: StoryGrammarEnforcement[] = ['strict', 'loose', 'off'];
  const FONTS: FontChoice[] = [
    'andika',
    'atkinson-hyperlegible',
    'lexend',
    'kosugi-maru',
    'opendyslexic',
  ];

  let tier2RawText = (initialOverride.tier2WordLockList ?? []).join(', ');

  async function persist() {
    // Parse Tier-2 word list from comma-separated raw text.
    ped.tier2WordLockList = tier2RawText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await advancedOverrideStore.setPedagogy(kidId, draftId, ped);
    onChange(ped);
  }
</script>

<section class="station station-1-5" data-testid="station-1-5-pedagogy-override">
  <header>
    <h2>Station 1.5 — Pedagogy Override</h2>
    <p class="subtitle">
      Tune the 9 evidence-based knobs directly. Each is grounded in a peer-reviewed study.
    </p>
  </header>

  <div class="knob">
    <label for="ehri">{PEDAGOGY_CITATIONS.ehriPhase.label}</label>
    <select id="ehri" bind:value={ped.ehriPhase} on:change={persist} data-testid="knob-ehri">
      <option value={undefined}>— auto (use S1 assessment) —</option>
      {#each EHRI_PHASES as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
    <cite data-testid="citation-ehri">{PEDAGOGY_CITATIONS.ehriPhase.citation}</cite>
  </div>

  <div class="knob">
    <label for="sentlen">{PEDAGOGY_CITATIONS.sentenceLengthCap.label}</label>
    <input
      id="sentlen"
      type="range"
      min="3"
      max="30"
      bind:value={ped.sentenceLengthCapWords}
      on:change={persist}
      data-testid="knob-sentence-cap"
    />
    <span class="knob-readout">{ped.sentenceLengthCapWords ?? '—'} words</span>
    <cite data-testid="citation-sentence">{PEDAGOGY_CITATIONS.sentenceLengthCap.citation}</cite>
  </div>

  <div class="knob">
    <label for="tier2">{PEDAGOGY_CITATIONS.tier2WordLock.label}</label>
    <textarea
      id="tier2"
      placeholder="glimmer, whisper, meander, ..."
      bind:value={tier2RawText}
      on:blur={persist}
      data-testid="knob-tier2"
    ></textarea>
    <cite data-testid="citation-tier2">{PEDAGOGY_CITATIONS.tier2WordLock.citation}</cite>
  </div>

  <div class="knob">
    <label for="rhyme">{PEDAGOGY_CITATIONS.rhymeDensity.label}</label>
    <input
      id="rhyme"
      type="range"
      min="0"
      max="100"
      bind:value={ped.rhymeDensityPct}
      on:change={persist}
      data-testid="knob-rhyme"
    />
    <span class="knob-readout">{ped.rhymeDensityPct ?? '—'} %</span>
    <cite data-testid="citation-rhyme">{PEDAGOGY_CITATIONS.rhymeDensity.citation}</cite>
  </div>

  <div class="knob">
    <label for="dialogic">{PEDAGOGY_CITATIONS.dialogicDensity.label}</label>
    <select id="dialogic" bind:value={ped.dialogicDensity} on:change={persist} data-testid="knob-dialogic">
      <option value={undefined}>— auto —</option>
      {#each DENSITIES as d}
        <option value={d}>{d}</option>
      {/each}
    </select>
    <cite data-testid="citation-dialogic">{PEDAGOGY_CITATIONS.dialogicDensity.citation}</cite>
  </div>

  <div class="knob">
    <label for="grammar">{PEDAGOGY_CITATIONS.storyGrammar.label}</label>
    <select id="grammar" bind:value={ped.storyGrammarEnforcement} on:change={persist} data-testid="knob-grammar">
      <option value={undefined}>— auto —</option>
      {#each ENFORCEMENTS as e}
        <option value={e}>{e}</option>
      {/each}
    </select>
    <cite data-testid="citation-grammar">{PEDAGOGY_CITATIONS.storyGrammar.citation}</cite>
  </div>

  <div class="knob">
    <label for="letter-spacing">{PEDAGOGY_CITATIONS.spacing.label}</label>
    <input
      id="letter-spacing"
      type="range"
      step="0.1"
      min="0"
      max="3"
      bind:value={ped.letterSpacingPx}
      on:change={persist}
      data-testid="knob-spacing"
    />
    <span class="knob-readout">{ped.letterSpacingPx ?? '—'} px</span>
    <cite data-testid="citation-spacing">{PEDAGOGY_CITATIONS.spacing.citation}</cite>
  </div>

  <div class="knob">
    <label for="leading">{PEDAGOGY_CITATIONS.leading.label}</label>
    <input
      id="leading"
      type="range"
      step="0.5"
      min="14"
      max="36"
      bind:value={ped.leadingPx}
      on:change={persist}
      data-testid="knob-leading"
    />
    <span class="knob-readout">{ped.leadingPx ?? '—'} px</span>
    <cite data-testid="citation-leading">{PEDAGOGY_CITATIONS.leading.citation}</cite>
  </div>

  <div class="knob">
    <label for="font">{PEDAGOGY_CITATIONS.font.label}</label>
    <select id="font" bind:value={ped.font} on:change={persist} data-testid="knob-font">
      <option value={undefined}>— auto —</option>
      {#each FONTS as f}
        <option value={f}>{f}</option>
      {/each}
    </select>
    <cite data-testid="citation-font">{PEDAGOGY_CITATIONS.font.citation}</cite>
  </div>
</section>

<style>
  .station {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .station header h2 {
    margin: 0 0 0.25rem;
  }
  .subtitle {
    color: var(--ui-muted, #888);
    margin: 0;
    font-size: 0.9rem;
  }
  .knob {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 1rem;
    row-gap: 0.25rem;
    padding: 0.75rem;
    border: 1px solid var(--ui-border, #ddd);
    border-radius: 0.5rem;
    background: var(--ui-card, transparent);
  }
  .knob label {
    grid-column: 1 / -1;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .knob cite {
    grid-column: 1 / -1;
    color: var(--ui-muted, #888);
    font-size: 0.75rem;
    font-style: italic;
  }
  .knob-readout {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  textarea {
    width: 100%;
    min-height: 4rem;
    grid-column: 1 / -1;
  }
</style>
