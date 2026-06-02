<!--
  Station 3.5 — Wish Engineering.
  Multi-voice recordings, audio-track upload (public domain), custom
  inscription with PreText effect picker, multi-author byline.

  Goal Phase 3.
-->
<script lang="ts">
  import { advancedOverrideStore } from '../services/AdvancedOverrideStore';
  import type {
    WishEngineering,
    MultiRecordingSlot,
    PreTextEffectMode,
  } from '../types';

  export let kidId: string;
  export let draftId: string;
  export let initialWish: WishEngineering = {};
  export let onChange: (w: WishEngineering) => void = () => {};

  let wish: WishEngineering = { ...initialWish };

  const EFFECTS: PreTextEffectMode[] = [
    'flow', 'bounce', 'wave', 'magnetic', 'glitch', 'dragon',
    'rise', 'scatter', 'orbit', 'gravity', 'vortex', 'parting-water',
  ];

  let recordings: MultiRecordingSlot[] = initialWish.multiRecordings ?? [];
  let bylineRaw = (initialWish.multiAuthorByline ?? []).join(', ');

  async function persist() {
    wish.multiRecordings = recordings.filter((r) => r.role.trim().length > 0);
    wish.multiAuthorByline = bylineRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await advancedOverrideStore.setWish(kidId, draftId, wish);
    onChange(wish);
  }

  function addRecordingSlot() {
    recordings = [
      ...recordings,
      { role: '', blobRef: '', durationSec: 0 },
    ];
  }
  function removeRecordingSlot(idx: number) {
    recordings = recordings.filter((_, i) => i !== idx);
    persist();
  }
</script>

<section class="station station-3-5" data-testid="station-3-5-wish-engineering">
  <header>
    <h2>Station 3.5 — Wish Engineering</h2>
    <p class="subtitle">Multi-voice, custom inscription, audio track.</p>
  </header>

  <div class="knob">
    <h3>Voice recordings <small>(≤30s each)</small></h3>
    {#each recordings as rec, i}
      <div class="recording-row" data-testid="recording-{i}">
        <input
          type="text"
          placeholder="Mom / Grandma / Sibling"
          bind:value={rec.role}
          on:blur={persist}
        />
        <span class="duration" data-testid="recording-duration-{i}">
          {rec.durationSec || 0}s
        </span>
        <button type="button" on:click={() => removeRecordingSlot(i)} aria-label="Remove">
          ×
        </button>
      </div>
    {/each}
    <button
      type="button"
      class="add-slot"
      on:click={addRecordingSlot}
      data-testid="add-recording-slot"
    >
      + Add voice
    </button>
  </div>

  <div class="knob">
    <h3>Audio track <small>(public domain only)</small></h3>
    <label class="disclaimer">
      <input
        type="checkbox"
        bind:checked={wish.audioTrackDisclaimerAccepted}
        on:change={persist}
        data-testid="audio-disclaimer"
      />
      I confirm this audio is public domain or properly licensed.
    </label>
  </div>

  <div class="knob">
    <h3>Custom inscription</h3>
    <textarea
      placeholder="For our brave Eli..."
      bind:value={wish.customInscription}
      on:blur={persist}
      data-testid="custom-inscription"
    ></textarea>
    <label for="effect">PreText effect</label>
    <select
      id="effect"
      bind:value={wish.inscriptionEffect}
      on:change={persist}
      data-testid="inscription-effect"
    >
      <option value={undefined}>— none —</option>
      {#each EFFECTS as e}
        <option value={e}>{e}</option>
      {/each}
    </select>
  </div>

  <div class="knob">
    <h3>Multi-author byline</h3>
    <input
      type="text"
      placeholder="Mom, Grandma Patty"
      bind:value={bylineRaw}
      on:blur={persist}
      data-testid="multi-author-byline"
    />
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
  .subtitle {
    color: var(--ui-muted, #888);
    margin: 0;
    font-size: 0.9rem;
  }
  .knob {
    padding: 0.75rem;
    border: 1px solid var(--ui-border, #ddd);
    border-radius: 0.5rem;
    background: var(--ui-card, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .knob h3 { margin: 0; font-size: 0.95rem; }
  .knob small { color: var(--ui-muted, #888); font-weight: normal; }
  .recording-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
  }
  .add-slot {
    align-self: flex-start;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
  }
  textarea { width: 100%; min-height: 3rem; }
  .disclaimer { font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem; }
</style>
