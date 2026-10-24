<script lang="ts">
  // The compile status pill (docs/03-ux.md §3.3): always in the same place, the only
  // "text" of the PDF bar. Click = error drawer; ▶/⏸ = auto-compile for this project;
  // ✕ while compiling = cancel.
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { formatDuration } from "#lib/ui/format.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { ENGINES, type Build } from "./build.svelte.ts";

  let { build, drawer, ontoggle }: { build: Build; drawer: boolean; ontoggle: () => void } = $props();

  const last = $derived(build.last);
  const c = $derived(build.counts);
  const engineName = $derived(ENGINES.find((e) => e.id === build.engine)?.label ?? "");
  const kind = $derived(
    build.busy ? "busy" : !last ? "none" : last.message ? "fail" : c.error ? "errors" : "ok",
  );
  const label = $derived.by(() => {
    if (build.phase === "downloading") return `Pobieranie pakietów (${build.downloads})${build.detail ? ` · ${build.detail}` : ""}`;
    if (build.phase === "waiting") return "Czekam, aż silnik skończy przygotowanie";
    if (build.busy) return `Kompiluję (${engineName})`;
    if (!last) return "Jeszcze nie kompilowano";
    if (last.message) return last.message;
    const parts = [`${engineName} · ${formatDuration(last.durationMs)}`];
    if (c.error) parts.push(`błędy: ${c.error}`);
    if (c.warning) parts.push(`ostrzeżenia: ${c.warning}`);
    if (c.box) parts.push(`overfull/underfull: ${c.box}`);
    return parts.join(" · ");
  });
</script>

<div class="pill {kind}" class:open={drawer}>
  <button class="main" use:tip={label} onclick={ontoggle}>
    {#if build.phase === "downloading"}
      <span class="pulse"><Icon name="cloud" size={14} /></span>
      <span class="num">{build.downloads}</span>
    {:else if build.busy}
      <span class="spin"><Icon name="refresh" size={13} /></span>
      <span class="txt">kompiluję</span>
    {:else if kind === "none"}
      <Icon name="pdf" size={13} />
      <span class="txt dim">—</span>
    {:else if kind === "fail"}
      <Icon name="alert" size={13} />
      <span class="txt">błąd</span>
    {:else}
      {#if c.error}
        <span class="cnt err"><Icon name="close" size={12} />{c.error}</span>
      {:else}
        <span class="dot"></span>
        <span class="txt">{formatDuration(last?.durationMs ?? 0)}</span>
      {/if}
      {#if c.warning}<span class="cnt warn"><Icon name="alert" size={12} />{c.warning}</span>{/if}
    {/if}
  </button>
  {#if build.busy}
    <button class="side" use:tip={{ label: "Przerwij kompilację", keys: keysOf("build.cancel") }} onclick={() => void build.cancel()}>
      <Icon name="close" size={12} />
    </button>
  {:else}
    <button
      class="side"
      class:off={!build.auto}
      use:tip={build.auto ? "Auto-kompilacja włączona (klik: wyłącz)" : "Auto-kompilacja wyłączona (klik: włącz)"}
      onclick={() => build.setAuto(!build.auto)}
    >
      <Icon name={build.auto ? "play" : "pause"} size={11} />
    </button>
  {/if}
</div>

<style>
  .pill {
    display: inline-flex;
    align-items: stretch;
    height: 26px;
    border-radius: 13px;
    border: 1px solid var(--line-2);
    background: var(--bg-panel);
    overflow: hidden;
    flex-shrink: 0;
    transition: border-color var(--t-fast), background var(--t-fast);
  }
  .pill button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
  }
  .main {
    padding: 0 10px 0 9px;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .main:hover,
  .side:hover {
    background: var(--hover);
  }
  .side {
    padding: 0 8px;
    border-left: 1px solid var(--line-1) !important;
    color: var(--text-dim-2) !important;
  }
  .side.off {
    color: var(--text-dim-4) !important;
  }
  .side:hover {
    color: var(--accent) !important;
  }
  .ok {
    color: var(--ok);
    border-color: var(--ok-a15);
  }
  .busy {
    color: var(--accent);
    border-color: var(--accent-a30);
    background: var(--accent-a10);
  }
  .errors,
  .fail {
    color: var(--danger);
    border-color: var(--danger-a40);
    background: var(--danger-a15);
  }
  .none {
    color: var(--text-dim-3);
  }
  .open {
    box-shadow: 0 0 0 1px var(--line-3);
  }
  .txt {
    color: var(--text);
  }
  .txt.dim {
    color: var(--text-dim-3);
  }
  .ok .txt {
    color: var(--text-dim-1);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .cnt {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-weight: 600;
  }
  .cnt.err {
    color: var(--danger);
  }
  .cnt.warn {
    color: var(--accent);
  }
  .num {
    font-weight: 600;
  }
  .spin {
    display: flex;
    animation: spin 1s linear infinite;
  }
  .pulse {
    display: flex;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
