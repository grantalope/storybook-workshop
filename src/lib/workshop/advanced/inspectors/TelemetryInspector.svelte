<!--
  TelemetryInspector — per-book + per-series pedagogy aggregate view.
  Local-only counters; no data leaves device.

  Goal Phase 8.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { pedagogyTelemetryService } from '../services/PedagogyTelemetryService';
  import type { PedagogyTelemetry, KidPedagogyReport } from '../types';

  export let kidId: string;
  export let currentBookId: string | null = null;

  let report: KidPedagogyReport | null = null;
  let currentBook: PedagogyTelemetry | null = null;
  let books: PedagogyTelemetry[] = [];

  onMount(refresh);

  async function refresh() {
    books = await pedagogyTelemetryService.listForKid(kidId);
    report = await pedagogyTelemetryService.getKidReport(kidId);
    if (currentBookId) currentBook = await pedagogyTelemetryService.getBook(currentBookId);
  }
</script>

<section class="inspector telemetry-inspector" data-testid="telemetry-inspector">
  <header>
    <h3>Telemetry — {kidId}</h3>
    <small data-testid="telemetry-local-only">local-only · no data leaves device</small>
  </header>

  {#if report}
    <div class="kid-report" data-testid="telemetry-kid-report">
      <div class="stat">
        <span class="stat-label">Books</span>
        <span class="stat-value" data-testid="telemetry-book-count">{report.bookCount}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Unique Tier-2</span>
        <span class="stat-value" data-testid="telemetry-unique-tier2">{report.uniqueTier2Words}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Mean dialogic / book</span>
        <span class="stat-value">{report.meanDialogicPromptsPerBook.toFixed(1)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Story-grammar pass rate</span>
        <span class="stat-value">{(report.storyGrammarPassRate * 100).toFixed(0)}%</span>
      </div>
    </div>

    <div class="ehri-breakdown">
      <h4>Ehri-phase journey</h4>
      <ul>
        {#each Object.entries(report.ehriPhaseBreakdown) as [phase, count]}
          <li data-testid="telemetry-ehri-{phase}">
            <strong>{phase}</strong>
            <span>{count}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if currentBook}
    <div class="current-book">
      <h4>This book</h4>
      <dl>
        <dt>Tier-2 words used</dt><dd>{currentBook.tier2WordsActual.join(', ') || '—'}</dd>
        <dt>Dialogic prompts</dt><dd>{currentBook.dialogicPromptCount}</dd>
        <dt>Rhyme density</dt><dd>{currentBook.rhymeDensityPct}%</dd>
        <dt>Ehri phase</dt><dd>{currentBook.ehriPhase}</dd>
        <dt>Story-grammar</dt><dd>{currentBook.storyGrammarPassCount} / {currentBook.storyGrammarTotalChecks}</dd>
      </dl>
    </div>
  {/if}

  {#if books.length > 0}
    <details class="series">
      <summary>Series ({books.length} books)</summary>
      <ul>
        {#each books as book}
          <li>
            <strong>{book.bookId}</strong>
            <span>{book.tier2WordsActual.length} words · {book.dialogicPromptCount} prompts</span>
          </li>
        {/each}
      </ul>
    </details>
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
  header small { font-size: 0.7rem; color: var(--ui-muted, #888); }
  .kid-report {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .stat {
    padding: 0.5rem;
    background: var(--ui-card, #f4f4f4);
    border-radius: 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .stat-label { font-size: 0.7rem; color: var(--ui-muted, #888); }
  .stat-value { font-size: 1.1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ehri-breakdown h4, .current-book h4 { margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
  .ehri-breakdown ul { list-style: none; padding: 0; margin: 0; font-size: 0.8rem; }
  .ehri-breakdown li { display: flex; justify-content: space-between; padding: 0.1rem 0; }
  .current-book dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.5rem;
    font-size: 0.8rem;
    margin: 0;
  }
  .current-book dt { font-weight: 600; }
  .series summary { font-size: 0.85rem; cursor: pointer; }
  .series ul { list-style: none; padding: 0; margin: 0.25rem 0; font-size: 0.8rem; }
  .series li {
    display: flex;
    justify-content: space-between;
    padding: 0.1rem 0;
  }
</style>
