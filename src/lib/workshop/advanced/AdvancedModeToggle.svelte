<!--
  AdvancedModeToggle — header switch that persists in IDB and reactively
  publishes the chosen mode to the workshop orchestrator (goal #6 ui-shell).

  Goal Phase 1.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { advancedOverrideStore } from './services/AdvancedOverrideStore';

  export let initialEnabled: boolean | null = null;
  export let onChange: (enabled: boolean) => void = () => {};

  let enabled: boolean = initialEnabled === true;
  let loaded = initialEnabled !== null;

  onMount(async () => {
    if (initialEnabled === null) {
      enabled = await advancedOverrideStore.getAdvancedMode();
      loaded = true;
    }
  });

  async function toggle() {
    enabled = !enabled;
    await advancedOverrideStore.setAdvancedMode(enabled);
    onChange(enabled);
  }
</script>

<button
  type="button"
  class="advanced-mode-toggle"
  class:active={enabled}
  aria-pressed={enabled}
  on:click={toggle}
  disabled={!loaded}
  data-testid="advanced-mode-toggle"
>
  <span class="switch-track">
    <span class="switch-thumb"></span>
  </span>
  <span class="label">{enabled ? 'Advanced' : 'Standard'} mode</span>
</button>

<style>
  .advanced-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--ui-border, #ccc);
    border-radius: 999px;
    background: var(--ui-bg, transparent);
    color: var(--ui-text, inherit);
    cursor: pointer;
    font-size: 0.875rem;
  }
  .advanced-mode-toggle.active {
    background: var(--ui-accent-bg, #1f3a5f);
    color: var(--ui-accent-text, #fff);
  }
  .switch-track {
    position: relative;
    width: 28px;
    height: 14px;
    border-radius: 14px;
    background: var(--ui-track, #aaa);
    transition: background 150ms ease;
  }
  .active .switch-track {
    background: var(--ui-accent, #4dd0e1);
  }
  .switch-thumb {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform 150ms ease;
  }
  .active .switch-thumb {
    transform: translateX(14px);
  }
</style>
