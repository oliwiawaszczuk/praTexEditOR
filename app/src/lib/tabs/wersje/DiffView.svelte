<script lang="ts">
  // The diff of one file: green added / red removed lines, word-level highlights inside
  // changed lines, unified or side by side. Rows are fixed-height and windowed, so a
  // 20 000-line diff costs the same as a 20-line one.
  import { untrack } from "svelte";
  import type { GitStore, Line } from "#lib/git/git.svelte.ts";
  import { hunkStarts, split, unified, type SRow, type URow } from "#lib/git/rows.ts";
  import { wordDiff, type Seg } from "#lib/git/wordDiff.ts";
  import { fileKind, kindColor, KIND_ICON } from "#lib/tree/kinds.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { STATUS_LABEL, splitPath } from "./util.ts";

  let { git }: { git: GitStore } = $props();

  const ROW = 20;
  const OVER = 12;

  let box = $state<HTMLDivElement>();
  let top = $state(0);
  let height = $state(600);

  const d = $derived(git.diff);
  const isSplit = $derived(git.layout === "split");
  const rows = $derived.by<(URow | SRow)[]>(() => (d ? (isSplit ? split(d.hunks) : unified(d.hunks)) : []));
  const starts = $derived(hunkStarts(rows));
  const maxLen = $derived(d ? d.hunks.reduce((m, h) => h.lines.reduce((n, l) => Math.max(n, l.text.length), m), 0) : 0);

  const first = $derived(Math.max(0, Math.floor(top / ROW) - OVER));
  const last = $derived(Math.min(rows.length, Math.ceil((top + height) / ROW) + OVER));
  const visible = $derived(rows.slice(first, last));

  // Keep the scroll position when the same file reloads (staging a hunk), reset for another.
  let shownKey = "";
  $effect(() => {
    const key = d ? `${git.selPath}|${git.view}|${git.picked.join()}|${git.vsWork}|${git.layout}` : "";
    untrack(() => {
      if (key !== shownKey && box) box.scrollTop = 0;
      shownKey = key;
    });
  });

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => (height = box!.clientHeight));
    ro.observe(box);
    height = box.clientHeight;
    return () => ro.disconnect();
  });

  // ── word-level highlights ────────────────────────────────────────────────
  const cache = new WeakMap<Line, { a: Seg[]; b: Seg[] } | null>();
  function segs(line: Line, mate: Line | null): Seg[] | null {
    if (!mate || line.kind === " " || line.text.length > 1500 || mate.text.length > 1500) return null;
    const del = line.kind === "-" ? line : mate;
    const add = line.kind === "-" ? mate : line;
    if (!cache.has(del)) cache.set(del, wordDiff(del.text, add.text));
    const r = cache.get(del);
    return r ? (line.kind === "-" ? r.a : r.b) : null;
  }

  // ── navigation between changes ───────────────────────────────────────────
  function jump(dir: 1 | -1): void {
    if (!box || !starts.length) return;
    const y = box.scrollTop;
    const target = dir === 1 ? starts.find((s) => s * ROW > y + 2) : [...starts].reverse().find((s) => s * ROW < y - 2);
    if (target !== undefined) box.scrollTo({ top: target * ROW });
  }
  $effect(() => {
    git.nav = jump;
    return () => (git.nav = null);
  });
  const next = () => jump(1);
  const prev = () => jump(-1);

  // ── actions ──────────────────────────────────────────────────────────────
  // Block-by-block revert only makes sense for files that already existed in the last commit.
  const hunkOps = $derived(git.view === "changes" && !git.fullFile && !!d && !d.binary && d.status !== "added" && d.status !== "deleted");
  const canOpenLine = $derived(!!d && d.status !== "deleted" && git.liveTarget);
  const restoreFrom = $derived(git.view === "history" && git.picked.length >= 1 ? (git.spec?.to === "work" ? git.picked[0] : (git.spec?.to ?? null)) : null);
  const restorable = $derived(restoreFrom !== null && !!d);

  function lineClick(l: Line | null): void {
    const n = l?.new;
    if (canOpenLine && git.selPath && n) void git.openInEditor(git.selPath, n);
  }

  const parts = $derived(d ? splitPath(d.path) : null);
  const kind = $derived(parts ? fileKind(parts.name) : "other");
</script>

{#snippet code(line: Line, mate: Line | null)}
  {@const s = segs(line, mate)}
  {#if s}{#each s as p, i (i)}{#if p.changed}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}{:else}{line.text || " "}{/if}
{/snippet}

{#snippet hunkActions(h: number)}
  {#if hunkOps}
    <button class="hb" use:tip={"Ten fragment wróci do wersji z ostatniego commita"} onclick={() => void git.discardHunk(h)}>
      <Icon name="undo" size={12} /><span>Odrzuć ten fragment</span>
    </button>
  {/if}
{/snippet}

<div class="diff">
  {#if d && parts}
    <header>
      <span class="ico" style:color={kindColor(kind)}><Icon name={KIND_ICON[kind]} size={15} /></span>
      <span class="path" title={d.path}>
        {#if parts.dir}<span class="dir">{parts.dir}/</span>{/if}<b>{parts.name}</b>
      </span>
      <span class="badge {d.status}">{STATUS_LABEL[d.status]}</span>
      {#if !d.binary}
        <span class="stat"><span class="add">+{d.additions}</span> <span class="del">−{d.deletions}</span></span>
      {/if}
      <span class="spacer"></span>
      {#if !d.binary && starts.length > 1}
        <span class="grp">
          <button class="ib" use:tip={{ label: "Poprzednia zmiana", keys: "shift+f7" }} onclick={prev}><Icon name="arrowUp" size={14} /></button>
          <button class="ib" use:tip={{ label: "Następna zmiana", keys: "f7" }} onclick={next}><Icon name="arrowDown" size={14} /></button>
        </span>
      {/if}
      <span class="grp">
        <button class="ib" class:on={!isSplit} use:tip={"Jedna kolumna"} onclick={() => git.setLayout("unified")}><Icon name="unifiedView" size={15} /></button>
        <button class="ib" class:on={isSplit} use:tip={"Dwie kolumny (przed | po)"} onclick={() => git.setLayout("split")}><Icon name="splitView" size={15} /></button>
      </span>
      <button class="ib" class:on={git.fullFile} use:tip={git.fullFile ? "Tylko zmiany" : "Cały plik"} onclick={() => git.toggleFull()}><Icon name="fullFile" size={15} /></button>
      <span class="sep"></span>
      {#if d.status !== "deleted" && git.view === "changes"}
        <button class="ib" use:tip={"Otwórz w edytorze"} onclick={() => void git.openInEditor(d.path)}><Icon name="edit" size={15} /></button>
      {/if}
      <button class="ib" use:tip={"Historia pliku"} onclick={() => git.setHistPath(d.path)}><Icon name="history" size={15} /></button>
      {#if restorable && restoreFrom}
        <button class="lb" use:tip={"Podmień plik na wersję z wybranego commita (obecny trafi do kosza)"} onclick={() => void git.restoreFrom(restoreFrom, d.path)}>
          <Icon name="undo" size={13} /><span>Przywróć tę wersję</span>
        </button>
      {/if}
    </header>

    {#if d.binary}
      <div class="note"><Icon name="file" size={28} /><span>Plik binarny — brak podglądu zmian.</span></div>
    {:else if !d.hunks.length}
      <div class="note"><Icon name="info" size={28} /><span>Treść bez zmian (zmieniły się tylko uprawnienia lub typ pliku).</span></div>
    {:else}
      <div class="scroll" bind:this={box} onscroll={() => (top = box!.scrollTop)}>
        <div class="spacer-box" class:isSplit style:height="{rows.length * ROW}px" style:--len="{maxLen}ch">
          {#each visible as r, k (first + k)}
            <div class="r" style:top="{(first + k) * ROW}px">
              {#if r.t === "hunk"}
                <div class="hunk">
                  <div class="hstick"><span class="htxt">{r.text}</span>{@render hunkActions(r.h)}</div>
                </div>
              {:else if "line" in r}
                {@const l = r.line}
                <div class="ln {l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''}">
                  <span class="g">{l.old ?? ""}</span>
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                  <span class="g" class:link={canOpenLine && !!l.new} onclick={() => lineClick(l)}>{l.new ?? ""}</span>
                  <span class="m">{l.kind === " " ? "" : l.kind}</span>
                  <span class="c">{@render code(l, r.mate)}</span>
                </div>
              {:else}
                {@const pr = r as SRow & { t: "pair" }}
                <div class="pair">
                  <div class="ln half {pr.l?.kind === '-' ? 'del' : ''}" class:empty={!pr.l}>
                    <span class="g">{pr.l?.old ?? ""}</span>
                    <span class="m">{pr.l?.kind === "-" ? "−" : ""}</span>
                    <span class="c">{#if pr.l}{@render code(pr.l, pr.l.kind === "-" ? pr.r : null)}{/if}</span>
                  </div>
                  <div class="ln half {pr.r?.kind === '+' ? 'add' : ''}" class:empty={!pr.r}>
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <span class="g" class:link={canOpenLine && !!pr.r?.new} onclick={() => lineClick(pr.r)}>{pr.r?.new ?? ""}</span>
                    <span class="m">{pr.r?.kind === "+" ? "+" : ""}</span>
                    <span class="c">{#if pr.r}{@render code(pr.r, pr.r.kind === "+" ? pr.l : null)}{/if}</span>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if d.truncated}
          <div class="trunc">Diff jest bardzo długi — pokazano pierwsze 20 000 linii.</div>
        {/if}
      </div>
    {/if}
  {:else if git.diffError}
    <div class="note"><Icon name="alert" size={28} /><span>{git.diffError}</span></div>
  {:else if git.diffLoading}
    <div class="note dim"><span>Ładowanie…</span></div>
  {:else}
    <div class="note dim">
      <Icon name="compare" size={34} />
      <span>{git.view === "changes" ? "Wybierz plik z listy, aby zobaczyć zmiany" : "Wybierz commit, a potem plik"}</span>
    </div>
  {/if}
</div>

<style>
  .diff {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--editor-bg);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 10px 0 14px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--line-1);
    background: var(--bg-panel);
    min-width: 0;
  }
  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .dir {
    color: var(--text-dim-2);
  }
  .path b {
    font-weight: 600;
    color: var(--text-strong);
  }
  .ico {
    display: flex;
  }
  .badge {
    font-size: 10.5px;
    padding: 1px 7px;
    border-radius: 9px;
    border: 1px solid var(--line-2);
    color: var(--text-dim-1);
    white-space: nowrap;
  }
  .badge.added {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .badge.deleted {
    color: var(--danger);
    border-color: var(--danger-a40);
  }
  .badge.modified,
  .badge.renamed {
    color: var(--accent);
    border-color: var(--accent-a40);
  }
  .stat {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .add {
    color: var(--ok);
  }
  .del {
    color: var(--danger);
  }
  .spacer {
    flex: 1;
  }
  .grp {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 7px;
    background: var(--bg-deep);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line-2);
  }
  .ib {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-dim-1);
    cursor: pointer;
  }
  .ib:hover {
    background: var(--hover);
    color: var(--text-strong);
  }
  .lb {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 11px;
    border: 1px solid var(--accent-a40);
    border-radius: 13px;
    background: var(--accent-a10);
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .lb:hover {
    background: var(--accent-a25);
  }
  .ib.on {
    background: var(--accent-a15);
    color: var(--accent);
  }
  .note {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dim-1);
    font-size: 13px;
    text-align: center;
    padding: 24px;
  }
  .note.dim {
    color: var(--text-dim-3);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
  }
  .spacer-box {
    position: relative;
    min-width: calc(110px + var(--len) + 24px);
  }
  .spacer-box.isSplit {
    min-width: calc(2 * (62px + var(--len) + 24px));
  }
  .r {
    position: absolute;
    left: 0;
    right: 0;
    height: 20px;
  }
  .ln {
    display: flex;
    height: 20px;
    line-height: 20px;
    white-space: pre;
    min-width: 100%;
  }
  .ln.add {
    background: var(--diff-ins);
  }
  .ln.del {
    background: var(--diff-del);
  }
  .ln.empty {
    background: repeating-linear-gradient(135deg, transparent 0 6px, var(--line-1) 6px 7px);
  }
  .g {
    flex: 0 0 48px;
    text-align: right;
    padding-right: 8px;
    color: var(--text-dim-3);
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .g.link {
    cursor: pointer;
  }
  .g.link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .m {
    flex: 0 0 14px;
    text-align: center;
    color: var(--text-dim-2);
    user-select: none;
  }
  .add .m {
    color: var(--ok);
  }
  .del .m {
    color: var(--danger);
  }
  .c {
    flex: 1;
    padding-right: 24px;
    color: var(--text);
  }
  mark {
    background: var(--diff-ins-strong);
    color: inherit;
    border-radius: 2px;
  }
  .del mark {
    background: var(--diff-del-strong);
  }
  .pair {
    display: flex;
    height: 20px;
    min-width: 100%;
  }
  .half {
    flex: 1 0 0;
    min-width: calc(62px + var(--len) + 24px);
  }
  .half + .half {
    border-left: 1px solid var(--line-2);
  }
  .hunk {
    height: 20px;
    background: var(--bg-panel);
    color: var(--text-dim-1);
    border-block: 1px solid var(--line-2);
  }
  .hstick {
    position: sticky;
    left: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 100%;
    padding-left: 12px;
    width: max-content;
    max-width: 100vw;
  }
  .htxt {
    font-family: system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
  }
  .hb {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 16px;
    padding: 0 8px;
    border-radius: 8px;
    border: 1px solid var(--danger-a40);
    background: var(--bg-deep);
    color: var(--danger);
    font-family: system-ui, sans-serif;
    font-size: 10.5px;
    cursor: pointer;
  }
  .hb:hover {
    background: var(--danger-a15);
  }
  .trunc {
    padding: 10px 16px;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    color: var(--text-dim-2);
    text-align: center;
  }
</style>
