<!--
  BookSpreadCanvas.svelte — Live-animated digital read-along of one
  BookSpreadComposite.

  Responsibilities:
    • Mount a <PretextTextCanvas /> driven by the composite's primary
      ProseElement + resolved EmotionalEffect.
    • Honor `prefers-reduced-motion`: when set, render static prose with
      Ehri-phase typography instead of the animated canvas.
    • Page-turn affordance: forwards a custom `book-page-turn` event when
      `nextSpread` / `prevSpread` props are clicked.
    • Voice-over playback hook: when `voiceOverUrl` is provided, an
      autoplay-opt-in <audio> ribbon appears below the canvas.
    • Tier-2 emphasis treatment overlays the rendered prose via DOM spans
      stacked beneath the canvas — the canvas itself is transparent.

  This component does NOT run the PretextCompositor's full `tick` loop; the
  compositor is owned by the parent page. We render only this spread's
  emotional-typography animation. The static obstacle layout (focal-point
  flow) is computed once on mount and re-projected when the composite changes.
-->
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import PretextTextCanvas from '../PretextTextCanvas.svelte';
  import type {
    BookSpreadComposite,
    EhriPhaseTypography,
    TextRun,
    Tier2EmphasisTreatment,
  } from '$lib/services/render';
  import type { PretextEffect } from '$lib/pretext/PretextEffectEngine';

  let {
    composite,
    width = 720,
    height = 540,
    voiceOverUrl = null,
    voiceOverAutoplay = false,
    tier2Treatment = 'weight',
  }: {
    composite: BookSpreadComposite;
    width?: number;
    height?: number;
    voiceOverUrl?: string | null;
    voiceOverAutoplay?: boolean;
    tier2Treatment?: Tier2EmphasisTreatment;
  } = $props();

  const dispatch = createEventDispatcher();

  let reducedMotion = $state(false);
  let mqListener: ((e: MediaQueryListEvent) => void) | null = null;
  let audioEl: HTMLAudioElement | null = $state(null);
  let voPlaying = $state(false);

  // Resolve the primary prose element from the composite.
  const proseEl = $derived.by(() => {
    return composite.elements.find(el => el.type === 'prose');
  });

  const proseId = $derived(proseEl?.id ?? '');
  const proseText = $derived(proseEl?.type === 'prose' ? proseEl.text : '');
  const fonts: EhriPhaseTypography = $derived(composite.fonts);

  // Pretext effect payload for the canvas overlay.
  const pretextEffect: PretextEffect | null = $derived.by(() => {
    if (!proseEl || proseEl.type !== 'prose') return null;
    return {
      mode: composite.effect,
      text: proseText,
      containerWidth: width,
      containerHeight: height,
      originX: proseEl.origin.x,
      originY: proseEl.origin.y,
    };
  });

  function fontCss(cfg: EhriPhaseTypography): string {
    return `${cfg.weight} ${cfg.sizePx}px ${cfg.fontFamily}`;
  }

  function runStyle(run: TextRun): string {
    if (run.emphasis !== 'tier2') return '';
    switch (tier2Treatment) {
      case 'italic': return 'font-style:italic;';
      case 'color':  return 'color:#7c3aed;';
      case 'weight':
      default:       return `font-weight:${Math.min(900, fonts.weight + 200)};`;
    }
  }

  const runs: TextRun[] = $derived.by(() => (proseId ? composite.emphasis[proseId] ?? [] : []));

  function turnPage(dir: 'next' | 'prev') {
    dispatch('book-page-turn', { direction: dir, fromSpread: composite.spreadIndex });
  }

  function toggleVoiceOver() {
    if (!audioEl) return;
    if (voPlaying) { audioEl.pause(); voPlaying = false; }
    else { audioEl.play().then(() => { voPlaying = true; }).catch(() => { voPlaying = false; }); }
  }

  onMount(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
      mqListener = (e: MediaQueryListEvent) => { reducedMotion = e.matches; };
      mq.addEventListener('change', mqListener);
    }
    if (voiceOverAutoplay && audioEl) {
      audioEl.play().then(() => { voPlaying = true; }).catch(() => { voPlaying = false; });
    }
  });

  onDestroy(() => {
    if (mqListener && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', mqListener);
    }
    if (audioEl) audioEl.pause();
  });
</script>

<section class="book-spread" style="width:{width}px;">
  <div class="spread-canvas" style="width:{width}px; height:{height}px;">
    <!-- Static prose layer with Tier-2 emphasis runs. Always rendered; the
         animated canvas overlays on top (or replaces, when reduced-motion). -->
    <div
      class="static-prose"
      data-testid="book-spread-static-prose"
      style="
        position:absolute; inset:0; padding:8px;
        font:{fontCss(fonts)};
        line-height:{fonts.leading};
        letter-spacing:{fonts.kerningEm}em;
        color:#1f2937;
        opacity:{reducedMotion ? 1 : 0.0};
      "
    >
      {#each runs as run, i (i)}<span style={runStyle(run)}>{run.text}</span>{/each}
    </div>

    {#if !reducedMotion && pretextEffect}
      <div class="animated-layer" style="position:absolute; inset:0;">
        <PretextTextCanvas
          {pretextEffect}
          font={fontCss(fonts)}
          color="#1f2937"
        />
      </div>
    {/if}
  </div>

  <nav class="page-turn" aria-label="Page navigation">
    <button type="button" onclick={() => turnPage('prev')} aria-label="Previous spread">←</button>
    <span class="spread-index" aria-live="polite">Spread {composite.spreadIndex + 1}</span>
    <button type="button" onclick={() => turnPage('next')} aria-label="Next spread">→</button>
  </nav>

  {#if voiceOverUrl}
    <div class="voice-over" data-testid="book-spread-voice-over">
      <audio bind:this={audioEl} src={voiceOverUrl} preload="metadata"></audio>
      <button type="button" onclick={toggleVoiceOver} aria-pressed={voPlaying}>
        {voPlaying ? '◼ Pause' : '▶ Play parent voice'}
      </button>
    </div>
  {/if}
</section>

<style>
  .book-spread {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: stretch;
  }
  .spread-canvas {
    position: relative;
    background: #fefce8;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.08);
  }
  .static-prose {
    pointer-events: none;
    overflow-wrap: break-word;
  }
  .page-turn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
    color: #475569;
    font-size: 13px;
  }
  .page-turn button {
    background: transparent;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .page-turn button:hover { background: #f1f5f9; }
  .voice-over {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    font-size: 12px;
    color: #475569;
  }
  .voice-over button {
    background: #1f2937;
    color: #fefce8;
    border: 0;
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
</style>
