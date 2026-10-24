<script lang="ts">
  // Tab-bar indicator of the TeX engine. Invisible when all is well; a pulsing cloud
  // while the one-time warm-up downloads packages; red when the engine is broken.
  import { engine } from "#lib/core/engine.svelte.ts";
  import Icon from "./Icon.svelte";
  import { tip } from "./tooltip.svelte.ts";

  let { onopen }: { onopen: () => void } = $props();

  const s = $derived(engine());
  let justReady = $state(false);
  let wasWarming = false;

  $effect(() => {
    if (s.phase === "warming") wasWarming = true;
    else if (s.phase === "ready" && wasWarming) {
      wasWarming = false;
      justReady = true;
      const t = setTimeout(() => (justReady = false), 2500);
      return () => clearTimeout(t);
    }
  });

  const label = $derived(
    s.phase === "warming"
      ? `Przygotowanie silnika TeX (jednorazowo): pobrano ${s.downloads} plików${s.detail ? ` · ${s.detail}` : ""}`
      : s.phase === "ready"
        ? `Silnik TeX gotowy · Tectonic ${s.version ?? ""}`
        : `Silnik TeX nie działa: ${s.detail}`,
  );
</script>

{#if s.phase === "warming" || s.phase === "error" || s.phase === "missing" || justReady}
  <button
    class="chip"
    class:warm={s.phase === "warming"}
    class:bad={s.phase === "error" || s.phase === "missing"}
    class:ok={s.phase === "ready"}
    use:tip={label}
    onclick={onopen}
  >
    {#if s.phase === "warming"}
      <span class="pulse"><Icon name="cloud" size={15} /></span>
      <span class="n">{s.downloads}</span>
    {:else if s.phase === "ready"}
      <Icon name="check" size={15} />
    {:else}
      <Icon name="alert" size={15} />
    {/if}
  </button>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    margin-bottom: 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    background: var(--shade);
    border: 1px solid var(--line-2);
    border-radius: 13px;
    cursor: pointer;
    animation: pop 0.2s ease;
  }
  .warm {
    color: var(--accent);
    border-color: var(--accent-a30);
  }
  .ok {
    color: var(--ok);
    border-color: rgba(123, 196, 127, 0.4);
  }
  .bad {
    color: var(--danger);
    border-color: rgba(255, 107, 107, 0.45);
  }
  .pulse {
    display: flex;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .n {
    font-variant-numeric: tabular-nums;
    min-width: 2ch;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.8);
      opacity: 0;
    }
  }
</style>
