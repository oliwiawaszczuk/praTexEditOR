<script lang="ts">
  // Left column, "Zmiany": every file that differs from the last commit, with how much
  // (+/−). One click shows the diff; "Odrzuć" brings a file back to the committed version
  // (old content goes to the trash). Commits are made outside the app.
  import type { FileSummary, GitStore } from "#lib/git/git.svelte.ts";
  import { fileKind, kindColor } from "#lib/tree/kinds.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { splitPath, STATUS_LABEL, STATUS_LETTER } from "./util.ts";

  let { git }: { git: GitStore } = $props();

  const list = $derived(git.changes);
  const sel = (f: FileSummary) => git.selPath === f.path;

  function menu(e: MouseEvent, f: FileSummary): void {
    e.preventDefault();
    git.select(f.path);
    openMenu(e, [
      { icon: "edit", label: "Otwórz w edytorze", disabled: f.status === "deleted", run: () => void git.openInEditor(f.path) },
      { icon: "history", label: "Historia pliku", run: () => git.setHistPath(f.path) },
      "sep",
      { icon: "undo", label: "Odrzuć zmiany w pliku…", danger: true, run: () => void git.discard([f.path]) },
    ]);
  }

  function key(e: KeyboardEvent): void {
    if (!list.length) return;
    const i = list.findIndex(sel);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      git.select(list[Math.min(list.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))].path);
    } else if (e.key === "Enter" && i >= 0 && list[i].status !== "deleted") {
      e.preventDefault();
      void git.openInEditor(list[i].path);
    }
  }
</script>

<div class="pane">
  <div class="top">
    <div class="title">
      <span class="ico"><Icon name="compare" size={16} /></span>
      <h2>Zmiany</h2>
      {#if list.length}<span class="count">{list.length}</span>{/if}
    </div>
    <p class="sub">
      względem ostatniego commita{#if git.repo?.head} <code>{git.repo.head}</code>{/if}
    </p>
    {#if list.length}
      <p class="sum">
        <span class="ad">+{git.totals.add}</span> <span class="de">−{git.totals.del}</span>
        <span class="dim">w {list.length} {list.length === 1 ? "pliku" : "plikach"}</span>
      </p>
    {/if}
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="list" role="listbox" tabindex="0" aria-label="Zmienione pliki" onkeydown={key}>
    {#each list as f (f.path)}
      {@const p = splitPath(f.path)}
      {@const k = fileKind(p.name)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="row {f.status}"
        class:sel={sel(f)}
        role="option"
        aria-selected={sel(f)}
        tabindex="-1"
        onclick={() => git.select(f.path)}
        ondblclick={() => f.status !== "deleted" && void git.openInEditor(f.path)}
        oncontextmenu={(e) => menu(e, f)}
      >
        <span class="letter" use:tip={STATUS_LABEL[f.status]}>{STATUS_LETTER[f.status]}</span>
        <span class="name" style:color={k === "other" ? undefined : kindColor(k)}>
          <b>{p.name}</b>{#if p.dir}<span class="dir">{p.dir}</span>{/if}
          {#if f.oldPath}<span class="dir">← {f.oldPath}</span>{/if}
        </span>
        <span class="stat">
          {#if f.binary}<span class="dim">binarny</span>{:else}<span class="ad">+{f.additions}</span><span class="de">−{f.deletions}</span>{/if}
        </span>
        <button class="rev" use:tip={"Odrzuć zmiany w tym pliku — wróci do wersji z ostatniego commita"} onclick={(e) => { e.stopPropagation(); void git.discard([f.path]); }}>
          <Icon name="undo" size={12} /><span>Odrzuć</span>
        </button>
      </div>
    {:else}
      <div class="clean">
        <span class="okico"><Icon name="check" size={26} /></span>
        <b>Brak zmian</b>
        <span>Pliki są takie same jak w ostatnim commicie.</span>
        <button class="link" onclick={() => git.setView("history")}><Icon name="history" size={13} /> Zobacz historię</button>
      </div>
    {/each}
  </div>

  <p class="foot"><Icon name="info" size={12} /><span>Commity robisz poza aplikacją (terminal, GitHub Desktop). Tu sprawdzasz zmiany i wracasz do dawnych wersji.</span></p>
</div>

<style>
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .top {
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--line-2);
    background: linear-gradient(180deg, var(--accent-a10), transparent);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .ico {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--accent-a15);
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--text-strong);
  }
  .count {
    padding: 1px 9px;
    border-radius: 10px;
    background: var(--accent);
    color: #1a1a1a;
    font-size: 12px;
    font-weight: 700;
  }
  .sub {
    margin: 7px 0 0;
    font-size: 11.5px;
    color: var(--text-dim-2);
  }
  .sub code {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: var(--text-dim-1);
  }
  .sum {
    margin: 6px 0 0;
    font-size: 12.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .ad {
    color: var(--ok);
  }
  .de {
    color: var(--danger);
    margin-left: 5px;
  }
  .dim {
    margin-left: 6px;
    font-weight: 400;
    color: var(--text-dim-3);
    font-size: 11.5px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    outline: none;
    padding: 6px 0;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    height: 32px;
    margin: 0 6px;
    padding: 0 8px 0 10px;
    border-radius: 7px;
    cursor: pointer;
  }
  .row::before {
    content: "";
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .row.added::before {
    background: var(--ok);
  }
  .row.deleted::before {
    background: var(--danger);
  }
  .row:hover {
    background: var(--hover);
  }
  .row.sel {
    background: var(--accent-a15);
  }
  .letter {
    flex: 0 0 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    color: var(--accent);
    background: var(--accent-a15);
  }
  .added .letter {
    color: var(--ok);
    background: var(--ok-a15);
  }
  .deleted .letter {
    color: var(--danger);
    background: var(--danger-a15);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .name b {
    font-weight: 500;
    color: var(--text-strong);
  }
  .dir {
    margin-left: 8px;
    font-size: 11px;
    color: var(--text-dim-3);
  }
  .stat {
    display: flex;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .rev {
    display: none;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--danger-a40);
    border-radius: 11px;
    background: var(--bg-deep);
    color: var(--danger);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .rev:hover {
    background: var(--danger-a15);
  }
  .row:hover .rev {
    display: flex;
  }
  .row:hover .stat {
    display: none;
  }
  .clean {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 44px 20px 20px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim-2);
  }
  .clean b {
    font-size: 14px;
    color: var(--text-strong);
    font-weight: 600;
  }
  .okico {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    margin-bottom: 6px;
    border-radius: 50%;
    background: var(--ok-a15);
    color: var(--ok);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 5px 11px;
    border: 1px solid var(--line-3);
    border-radius: 7px;
    background: none;
    color: var(--text-dim-1);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    border-color: var(--accent-a40);
    color: var(--accent);
  }
  .foot {
    display: flex;
    gap: 7px;
    margin: 0;
    padding: 10px 14px;
    border-top: 1px solid var(--line-1);
    font-size: 11px;
    line-height: 1.45;
    color: var(--text-dim-3);
  }
  .foot :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }
</style>
