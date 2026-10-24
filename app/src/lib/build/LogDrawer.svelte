<script lang="ts">
  // Error drawer at the bottom of the PDF column (docs/03-ux.md §4): filter pictograms,
  // one row per diagnostic (click = jump to the line), raw log on request.
  import { currentProject, type Project } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { relName, type Build, type Severity } from "./build.svelte.ts";

  let { build, onclose }: { build: Build; onclose: () => void } = $props();

  const project = $derived(currentProject() as Project);
  const FILTERS: { s: Severity; icon: IconName; label: string }[] = [
    { s: "error", icon: "close", label: "Błędy" },
    { s: "warning", icon: "alert", label: "Ostrzeżenia" },
    { s: "box", icon: "layout", label: "Overfull / underfull (za szerokie wiersze)" },
  ];

  let raw = $state<string | null>(null);

  async function showRaw(): Promise<void> {
    if (raw !== null) {
      raw = null;
      return;
    }
    try {
      raw = await call<string>("build_log", { pid: project.id });
    } catch (e) {
      raw = e instanceof Error ? e.message : String(e);
    }
  }

  // A new build replaces the log on screen too.
  $effect(() => {
    void build.last;
    raw = null;
  });
</script>

<div class="drawer">
  <div class="head">
    {#each FILTERS as f (f.s)}
      {@const n = build.counts[f.s]}
      <button
        class="flt {f.s}"
        class:on={build.filters[f.s]}
        use:tip={`${f.label}: ${build.filters[f.s] ? "widoczne" : "ukryte"}`}
        onclick={() => build.setFilter(f.s, !build.filters[f.s])}
      >
        <Icon name={f.icon} size={12} />
        <span>{n}</span>
      </button>
    {/each}
    <span class="spacer"></span>
    <button class="icon-btn" class:on={raw !== null} use:tip={"Surowy log"} onclick={() => void showRaw()}><Icon name="note" size={14} /></button>
    <button class="icon-btn" use:tip={"Zwiń"} onclick={onclose}><Icon name="chevronDown" size={15} /></button>
  </div>

  {#if raw !== null}
    <pre class="raw">{raw}</pre>
  {:else if build.last?.message}
    <div class="empty bad"><Icon name="alert" size={16} /> {build.last.message}</div>
  {:else if !build.visible.length}
    <div class="empty">
      <Icon name="check" size={16} />
      {build.last ? (build.counts.error + build.counts.warning + build.counts.box ? "Nic przy tych filtrach" : "Bez błędów i ostrzeżeń") : "Jeszcze nie kompilowano"}
    </div>
  {:else}
    <ul class="list">
      {#each build.visible as d, i (i)}
        <li>
          <button class="row {d.severity}" disabled={!d.file} onclick={() => void build.reveal(d)}>
            <span class="ic"><Icon name={d.severity === "error" ? "close" : d.severity === "warning" ? "alert" : "layout"} size={12} /></span>
            <span class="where">{d.file ? relName(d.file, project) : "—"}{d.line ? `:${d.line}` : ""}</span>
            <span class="msg">
              {d.message}
              {#if d.hint}<span class="hint">{d.hint}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .drawer {
    flex-shrink: 0;
    height: min(40%, 300px);
    min-height: 120px;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-top: 1px solid var(--line-2);
    animation: up 0.15s ease;
  }
  @keyframes up {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
  .head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 6px 0 8px;
    border-bottom: 1px solid var(--line-1);
  }
  .spacer {
    flex: 1;
  }
  .flt {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: 11px;
    color: var(--text-dim-4);
    cursor: pointer;
  }
  .flt.on.error {
    color: var(--danger);
    border-color: var(--danger-a40);
    background: var(--danger-a15);
  }
  .flt.on.warning {
    color: var(--accent);
    border-color: var(--accent-a30);
    background: var(--accent-a10);
  }
  .flt.on.box {
    color: var(--text-dim-1);
    border-color: var(--line-3);
    background: var(--hover);
  }
  .icon-btn.on {
    color: var(--accent);
  }
  .list {
    flex: 1;
    overflow: auto;
    list-style: none;
    padding: 4px 0;
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 16px minmax(70px, max-content) 1fr;
    align-items: baseline;
    gap: 8px;
    padding: 5px 12px;
    text-align: left;
    font-size: var(--fs-sm);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .row:hover:not(:disabled) {
    background: var(--hover);
  }
  .row:disabled {
    cursor: default;
  }
  .ic {
    display: flex;
    align-self: center;
  }
  .error .ic {
    color: var(--danger);
  }
  .warning .ic {
    color: var(--accent);
  }
  .box .ic {
    color: var(--text-dim-3);
  }
  .where {
    color: var(--text-dim-2);
    white-space: nowrap;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .msg {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .hint {
    display: block;
    margin-top: 2px;
    color: var(--text-dim-2);
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
    text-align: center;
  }
  .empty.bad {
    color: var(--danger);
  }
  .raw {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 8px 12px;
    font-family: var(--font);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-dim-1);
    white-space: pre-wrap;
    -webkit-user-select: text;
    user-select: text;
  }
</style>
