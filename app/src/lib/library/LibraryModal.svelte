<script lang="ts">
  // Two pickers in one window (docs/03-ux.md §4): "Biblioteka" — search the .bib entries,
  // tick several, insert \cite{a,b} (⇧↵ opens the entry in its .bib); "Galeria" —
  // thumbnails of the project's images, click / ↵ inserts \includegraphics.
  import { tick } from "svelte";
  import { currentProject } from "#lib/core/projects.svelte.ts";
  import { call, protoUrl } from "#lib/core/tauri.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { activeIndex, type BibItem } from "#lib/index/index.svelte.ts";
  import { fuzzy } from "#lib/palette/fuzzy.ts";
  import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { closeLibrary, libraryOpen } from "./library.svelte.ts";

  const kind = $derived(libraryOpen());
  const project = $derived(currentProject());

  let query = $state("");
  let sel = $state(0);
  let ticked = $state(new Set<string>());
  let input = $state<HTMLInputElement>();
  let box = $state<HTMLDivElement>();
  let images = $state<{ path: string; rel: string }[]>([]);
  let cols = $state(4);

  const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;

  $effect(() => {
    if (!kind) return;
    query = "";
    sel = 0;
    ticked = new Set();
    void tick().then(() => input?.focus());
    if (kind === "images" && project) {
      const base = project.main?.replace(/[\\/][^\\/]*$/, "") ?? project.roots[0];
      void call<{ path: string; dir: boolean }[]>("fs_files", { pid: project.id })
        .then((es) => (images = es.filter((e) => !e.dir && IMG.test(e.path)).map((e) => ({ path: e.path, rel: e.path.startsWith(base + "/") ? e.path.slice(base.length + 1) : e.path }))))
        .catch(() => (images = []));
    }
  });

  const text = (b: BibItem) => `${b.key} ${b.authors} ${b.year} ${b.title}`;
  const entries = $derived.by(() => {
    const all = activeIndex()?.snap.bib ?? [];
    const q = query.trim();
    if (!q) return all;
    return all
      .map((b) => ({ b, m: fuzzy(q, text(b)) }))
      .filter((x) => x.m)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
      .map((x) => x.b);
  });
  const pics = $derived(query.trim() ? images.filter((i) => fuzzy(query, i.rel)) : images);
  const count = $derived(kind === "bib" ? entries.length : pics.length);

  $effect(() => {
    void count;
    sel = 0;
  });

  const uid = (b: BibItem) => `${b.file}:${b.key}`;

  function toggle(b: BibItem): void {
    const next = new Set(ticked);
    if (!next.delete(b.key)) next.add(b.key);
    ticked = next;
  }

  function insert(text: string): void {
    closeLibrary();
    showCol("mid");
    void tick().then(() => editor()?.insertText(text));
  }

  function confirm(alt: boolean): void {
    if (kind === "bib") {
      const cur = entries[sel];
      if (alt && cur) {
        closeLibrary();
        showCol("mid");
        void editor()?.reveal(cur.file, cur.line);
        return;
      }
      const keys = ticked.size ? [...ticked] : cur ? [cur.key] : [];
      if (keys.length) insert(`\\cite{${keys.join(",")}}`);
    } else {
      const cur = pics[sel];
      if (cur) insert(`\\includegraphics[width=0.8\\textwidth]{${cur.rel}}`);
    }
  }

  function move(d: number): void {
    if (!count) return;
    sel = Math.min(count - 1, Math.max(0, sel + d));
    void tick().then(() => box?.querySelector(".sel")?.scrollIntoView({ block: "nearest" }));
  }

  function onKey(e: KeyboardEvent): void {
    if (!kind) return;
    const grid = kind === "images";
    if (e.key === "Escape") {
      e.preventDefault();
      closeLibrary();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(grid ? cols : 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(grid ? -cols : -1);
    } else if (grid && e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (grid && e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirm(e.shiftKey);
    } else if (kind === "bib" && e.key === " " && (e.metaKey || e.ctrlKey || e.altKey) && entries[sel]) {
      e.preventDefault();
      toggle(entries[sel]);
    }
  }

  // Grid columns follow the width (arrow keys move by whole rows).
  $effect(() => {
    if (!box || kind !== "images") return;
    const ro = new ResizeObserver(() => (cols = Math.max(1, Math.floor(box!.clientWidth / 156))));
    ro.observe(box);
    return () => ro.disconnect();
  });
</script>

{#if kind}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={closeLibrary}>
    <div class="modal" role="dialog" aria-label={kind === "bib" ? "Biblioteka" : "Galeria"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="field">
        <Icon name={kind === "bib" ? "quote" : "image"} size={15} />
        <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder={kind === "bib" ? "autor, rok, tytuł, klucz…" : "nazwa obrazu…"} spellcheck="false" />
        <span class="n">{count}</span>
        {#if kind === "bib" && ticked.size}
          <button class="go" use:tip={"Wstaw zaznaczone (↵)"} onclick={() => confirm(false)}><Icon name="check" size={14} />{ticked.size}</button>
        {/if}
      </div>
      <div class="body" bind:this={box} class:grid={kind === "images"}>
        {#if kind === "bib"}
          {#each entries as b, i (uid(b))}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="row" class:sel={i === sel} onmousemove={() => (sel = i)} onclick={() => (ticked.size ? toggle(b) : (sel = i, confirm(false)))}>
              <button class="box" class:on={ticked.has(b.key)} use:tip={"Zaznacz (⌘Spacja)"} onclick={(e) => (e.stopPropagation(), toggle(b))}>
                {#if ticked.has(b.key)}<Icon name="check" size={12} />{/if}
              </button>
              <div class="txt">
                <div class="t1"><b>{b.key}</b><span class="yr">{b.year}</span><span class="kind">{b.kind}</span></div>
                <div class="t2">{b.title}</div>
                <div class="t3">{b.authors}</div>
              </div>
            </div>
          {:else}
            <div class="empty"><Icon name="search" size={18} /></div>
          {/each}
        {:else}
          {#each pics as p, i (p.path)}
            <button class="tile" class:sel={i === sel} onmousemove={() => (sel = i)} onclick={() => ((sel = i), confirm(false))}>
              <img src={project ? protoUrl(`file/${project.id}`, { p: p.path }) : ""} alt={p.rel} loading="lazy" />
              <span>{p.rel}</span>
            </button>
          {:else}
            <div class="empty wide"><Icon name="image" size={18} /></div>
          {/each}
        {/if}
      </div>
      <div class="foot">
        <span><kbd>↑↓</kbd> wybór</span>
        {#if kind === "bib"}<span><kbd>⌘Spacja</kbd> zaznacz</span><span><kbd>↵</kbd> wstaw</span><span><kbd>⇧↵</kbd> otwórz w .bib</span>{:else}<span><kbd>←→</kbd></span><span><kbd>↵</kbd> wstaw</span>{/if}
        <span><kbd>Esc</kbd></span>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 890;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 9vh;
    background: var(--shade);
  }
  .modal {
    width: min(720px, 94vw);
    max-height: 74vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 40px var(--backdrop);
    overflow: hidden;
    animation: drop 0.12s ease;
  }
  @keyframes drop {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 44px;
    color: var(--text-dim-2);
    border-bottom: 1px solid var(--line-2);
  }
  .field input {
    flex: 1;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--fs-lg);
    color: var(--text);
  }
  .n {
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    color: var(--accent);
    background: var(--accent-a10);
    border: 1px solid var(--accent-a30);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .body {
    overflow: auto;
    padding: 4px;
    min-height: 120px;
  }
  .body.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 8px;
    padding: 8px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .row.sel {
    background: var(--accent-a10);
  }
  .box {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg-panel);
    background: transparent;
    border: 1px solid var(--line-3);
    border-radius: 4px;
    cursor: pointer;
  }
  .box.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .txt {
    min-width: 0;
    flex: 1;
    font-size: var(--fs-md);
  }
  .t1 {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .t1 b {
    color: var(--accent);
    font-weight: 600;
  }
  .yr,
  .kind,
  .t3 {
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
  .t2 {
    color: var(--text);
    margin: 1px 0;
  }
  .t3,
  .t2 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-width: 0;
  }
  .tile.sel {
    background: var(--accent-a10);
    border-color: var(--accent-a30);
  }
  .tile img {
    width: 100%;
    height: 96px;
    object-fit: contain;
    background: var(--bg-panel-2);
    border-radius: 4px;
  }
  .tile span {
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    display: flex;
    justify-content: center;
    padding: 24px;
    color: var(--text-dim-4);
  }
  .empty.wide {
    grid-column: 1 / -1;
  }
  .foot {
    display: flex;
    gap: 14px;
    padding: 6px 14px;
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
    border-top: 1px solid var(--line-2);
  }
  kbd {
    font-family: var(--font);
    padding: 0 5px;
    border: 1px solid var(--line-3);
    border-radius: 4px;
    color: var(--text-dim-2);
  }
</style>
