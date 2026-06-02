<!--
  DiffInspector — side-by-side compare any two snapshots + rollback.

  Goal Phase 7.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { diffSnapshotStore } from '../services/DiffSnapshotStore';
  import type { DiffSnapshot } from '../types';

  export let draftId: string;
  export let onRollback: (snapshot: DiffSnapshot) => void = () => {};

  let snapshots: DiffSnapshot[] = [];
  let leftId: string | null = null;
  let rightId: string | null = null;
  let compareResult: { left: DiffSnapshot; right: DiffSnapshot; same: boolean } | null = null;

  onMount(refresh);

  async function refresh() {
    snapshots = await diffSnapshotStore.listForDraft(draftId);
    if (snapshots.length >= 2) {
      leftId = leftId ?? snapshots[1].id;
      rightId = rightId ?? snapshots[0].id;
      await compare();
    } else if (snapshots.length === 1) {
      leftId = snapshots[0].id;
      rightId = snapshots[0].id;
      await compare();
    }
  }

  async function compare() {
    if (!leftId || !rightId) {
      compareResult = null;
      return;
    }
    compareResult = await diffSnapshotStore.compare(leftId, rightId);
  }

  async function rollback(s: DiffSnapshot) {
    const restored = await diffSnapshotStore.rollback({ draftId, toId: s.id });
    if (restored) onRollback(restored);
  }

  $: if (leftId || rightId) compare();
</script>

<section class="inspector diff-inspector" data-testid="diff-inspector">
  <header>
    <h3>Diff Inspector</h3>
    <span class="count" data-testid="diff-snapshot-count">{snapshots.length} snapshots</span>
  </header>
  {#if snapshots.length === 0}
    <p class="empty">No snapshots yet. Redo a scene to capture one.</p>
  {:else}
    <div class="controls">
      <label>
        Left
        <select bind:value={leftId} data-testid="diff-left-select">
          {#each snapshots as s}
            <option value={s.id}>v{s.version} {s.label ? `— ${s.label}` : ''}</option>
          {/each}
        </select>
      </label>
      <label>
        Right
        <select bind:value={rightId} data-testid="diff-right-select">
          {#each snapshots as s}
            <option value={s.id}>v{s.version} {s.label ? `— ${s.label}` : ''}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if compareResult}
      <p class="status" class:same={compareResult.same} data-testid="diff-status">
        {compareResult.same ? 'Snapshots are identical.' : 'Snapshots differ.'}
      </p>
      <div class="side-by-side">
        <pre data-testid="diff-left-preview">{compareResult.left.sceneTreeJson.slice(0, 1200)}{compareResult.left.sceneTreeJson.length > 1200 ? '…' : ''}</pre>
        <pre data-testid="diff-right-preview">{compareResult.right.sceneTreeJson.slice(0, 1200)}{compareResult.right.sceneTreeJson.length > 1200 ? '…' : ''}</pre>
      </div>
    {/if}
    <div class="rollback-list">
      <h4>Rollback</h4>
      <ul>
        {#each snapshots as s}
          <li>
            <span>v{s.version}</span>
            {#if s.label}<small>{s.label}</small>{/if}
            <button
              type="button"
              on:click={() => rollback(s)}
              data-testid="diff-rollback-{s.version}"
            >
              Roll back
            </button>
          </li>
        {/each}
      </ul>
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
  .count { font-size: 0.75rem; color: var(--ui-muted, #888); }
  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .controls label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
  }
  .status { font-size: 0.8rem; color: var(--ui-warn, #c33); margin: 0.5rem 0; }
  .status.same { color: var(--ui-ok, #2a7); }
  .side-by-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .side-by-side pre {
    font-size: 0.7rem;
    overflow: auto;
    max-height: 200px;
    padding: 0.25rem;
    background: var(--ui-card, #f4f4f4);
    border-radius: 0.25rem;
  }
  .rollback-list h4 { margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
  .rollback-list ul { list-style: none; padding: 0; margin: 0; }
  .rollback-list li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.25rem;
    align-items: center;
    padding: 0.15rem 0;
    font-size: 0.8rem;
  }
  .empty { color: var(--ui-muted, #888); font-size: 0.85rem; }
</style>
