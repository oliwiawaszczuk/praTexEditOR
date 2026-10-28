<script lang="ts">
  // Left column, "Historia": the commits (newest first) on top; below, the files of what
  // is compared. Click = one commit; ⌘/Ctrl/Shift-click a second one = compare the two;
  // "do stanu roboczego" compares a commit with what is on disk now.
  import type { GitStore } from "#lib/git/git.svelte.ts";
  import { fileKind, kindColor } from "#lib/tree/kinds.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { splitPath, STATUS_LETTER, STATUS_LABEL, when } from "./util.ts";

  let { git }: { git: GitStore } = $props();

  let loadingMore = $state(false);

  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement;
    if (git.more && !loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 160) {
      loadingMore = true;
      void git.loadHistory(false).finally(() => (loadingMore = false));
    }
  }

  const byId = (id: string) => git.commits.find((c) => c.id === id);

  function menu(e: MouseEvent, id: string): void {
    e.preventDefault();
    openMenu(e, [
      { icon: "compare", label: "Porównaj ze stanem roboczym", run: () => git.compareWithWork(id) },
      ...(git.picked.length === 1 && git.picked[0] !== id ? [{ icon: "compare" as const, label: "Porównaj z zaznaczonym commitem", run: () => git.pick(id, true) }] : []),
      "sep",
      { icon: "copy", label: "Kopiuj identyfikator", run: () => void navigator.clipboard.writeText(id).then(() => toast("Skopiowano", { icon: "copy" })) },
    ]);
  }

  function key(e: KeyboardEvent): void {
    const i = git.commits.findIndex((c) => c.id === git.picked[git.picked.length - 1]);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = git.commits[Math.min(git.commits.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) git.pick(n.id, e.shiftKey);
    }
  }

  const range = $derived(git.picked.length === 2 ? git.picked.map((id) => byId(id)?.short ?? "") : null);
</script>

<div class="pane">
  {#if git.histPath}
    <div class="filter">
      <Icon name="file" size={13} />
      <span class="fp" title={git.histPath}>{git.histPath}</span>
      <button class="x" use:tip={"Pokaż całą historię"} onclick={() => git.setHistPath(null)}><Icon name="close" size={12} /></button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="commits" role="listbox" tabindex="0" aria-label="Commity" onscroll={onScroll} onkeydown={key}>
    {#each git.commits as c (c.id)}
      {@const on = git.picked.includes(c.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="c"
        class:on
        role="option"
        aria-selected={on}
        tabindex="-1"
        onclick={(e) => git.pick(c.id, e.metaKey || e.ctrlKey || e.shiftKey)}
        oncontextmenu={(e) => menu(e, c.id)}
      >
        <span class="rail"><span class="node" class:merge={c.parents > 1}></span></span>
        <span class="body">
          <span class="sum">
            {#each c.refs as r (r)}<span class="ref" class:head={r === "HEAD"}>{r}</span>{/each}
            <span class="s" title={c.message}>{c.summary || "(bez opisu)"}</span>
          </span>
          <span class="meta">{c.author} · {when(c.time)} · <code>{c.short}</code></span>
        </span>
        <button class="cmp" use:tip={"Porównaj ze stanem roboczym"} onclick={(e) => { e.stopPropagation(); git.compareWithWork(c.id); }}>
          <Icon name="compare" size={14} />
        </button>
      </div>
    {:else}
      <div class="empty">
        <Icon name="history" size={26} />
        <b>{git.histPath ? "Brak historii tego pliku" : "Brak commitów"}</b>
        <span>{git.histPath ? "Plik nie był jeszcze zatwierdzany." : "Zatwierdź pierwsze zmiany w zakładce „Zmiany”."}</span>
      </div>
    {/each}
    {#if git.more}<div class="more">Wczytuję starsze…</div>{/if}
  </div>

  <div class="files">
    <div class="fh">
      {#if range}
        <span class="rg"><code>{range[0]}</code><Icon name="compare" size={12} /><code>{range[1]}</code></span>
        <button class="x" use:tip={"Porównuj tylko pierwszy commit"} onclick={() => git.clearSecond()}><Icon name="close" size={12} /></button>
      {:else if git.picked.length === 1}
        <span class="seg">
          <button class:on={!git.vsWork} onclick={() => git.setVsWork(false)}>Zmiany tego commita</button>
          <button class:on={git.vsWork} onclick={() => git.setVsWork(true)}>Do stanu roboczego</button>
        </span>
      {:else}
        <span class="hint">Wybierz commit. <kbd>⌘</kbd>-klik drugiego porówna oba.</span>
      {/if}
      {#if git.files.length}<span class="cnt">{git.files.length}</span>{/if}
    </div>
    <div class="flist">
      {#each git.files as f (f.path)}
        {@const p = splitPath(f.path)}
        {@const k = fileKind(p.name)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="f" class:sel={git.selPath === f.path} onclick={() => git.select(f.path)}>
          <span class="letter {f.status}" use:tip={STATUS_LABEL[f.status]}>{STATUS_LETTER[f.status]}</span>
          <span class="name" style:color={k === "other" ? undefined : kindColor(k)}>
            <b>{p.name}</b>{#if p.dir}<span class="dir">{p.dir}</span>{/if}
          </span>
          {#if !f.binary}<span class="st"><span class="ad">+{f.additions}</span><span class="de">−{f.deletions}</span></span>{/if}
        </div>
      {/each}
      {#if git.picked.length && !git.files.length}
        <div class="none">Brak różnic w plikach.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--line-1);
    background: var(--accent-a10);
    color: var(--accent);
    font-size: 12px;
  }
  .fp {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 5px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .x:hover {
    background: var(--line-3);
  }
  .commits {
    flex: 1.4;
    min-height: 80px;
    overflow-y: auto;
    outline: none;
  }
  .c {
    display: flex;
    align-items: stretch;
    gap: 6px;
    min-height: 46px;
    padding: 0 6px 0 4px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .c:hover {
    background: var(--hover);
  }
  .c.on {
    background: var(--accent-a10);
    border-left-color: var(--accent);
  }
  .rail {
    position: relative;
    flex: 0 0 18px;
  }
  .rail::before {
    content: "";
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--line-3);
  }
  .node {
    position: absolute;
    left: 3px;
    top: 17px;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--bg-panel-2);
    border: 2px solid var(--text-dim-2);
  }
  .c.on .node {
    border-color: var(--accent);
    background: var(--accent);
  }
  .node.merge {
    border-radius: 3px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 6px 0;
  }
  .sum {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .s {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: var(--text-strong);
  }
  .ref {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 15px;
    color: var(--text-dim-1);
    border: 1px solid var(--line-3);
  }
  .ref.head {
    color: #1a1a1a;
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .meta {
    font-size: 11px;
    color: var(--text-dim-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  code {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
  }
  .cmp {
    align-self: center;
    display: none;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-dim-1);
    cursor: pointer;
  }
  .c:hover .cmp {
    display: flex;
  }
  .cmp:hover {
    background: var(--line-3);
    color: var(--accent);
  }
  .more {
    padding: 10px;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim-3);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 40px 20px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim-2);
  }
  .empty b {
    font-size: 13px;
    color: var(--text-strong);
  }
  .files {
    flex: 1;
    min-height: 110px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line-2);
    background: var(--bg-panel-2);
  }
  .fh {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--line-1);
    flex-shrink: 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 7px;
    background: var(--bg-deep);
  }
  .seg button {
    padding: 3px 9px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-dim-1);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent-a15);
    color: var(--accent);
  }
  .rg {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    color: var(--text-dim-1);
  }
  .hint {
    flex: 1;
    font-size: 11.5px;
    color: var(--text-dim-3);
  }
  kbd {
    font: inherit;
    padding: 0 4px;
    border: 1px solid var(--line-3);
    border-radius: 4px;
  }
  .cnt {
    margin-left: auto;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--line-2);
    font-size: 10.5px;
    color: var(--text-dim-1);
  }
  .flist {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .f {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 10px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .f:hover {
    background: var(--hover);
  }
  .f.sel {
    background: var(--accent-a10);
    border-left-color: var(--accent);
  }
  .letter {
    flex: 0 0 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    color: var(--accent);
    background: var(--accent-a10);
  }
  .letter.added {
    color: var(--ok);
    background: var(--ok-a15);
  }
  .letter.deleted {
    color: var(--danger);
    background: var(--danger-a15);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .name b {
    font-weight: 500;
    color: var(--text);
  }
  .dir {
    margin-left: 7px;
    font-size: 11px;
    color: var(--text-dim-3);
  }
  .st {
    display: flex;
    gap: 6px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .ad {
    color: var(--ok);
  }
  .de {
    color: var(--danger);
  }
  .none {
    padding: 18px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim-3);
  }
</style>
