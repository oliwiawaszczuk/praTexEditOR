<script lang="ts">
  // Quick open + command palette. "" → project files (recent first), ">" → commands,
  // "$" snippets, "@" sections, "#" labels, "&" bibliography (project index, E6).
  import { tick } from "svelte";
  import { allCommands, keysOf, type Command } from "#lib/core/commands.svelte.ts";
  import { formatKeys } from "#lib/core/keys.ts";
  import { currentProject, wsGet } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
  import { fileKind, KIND_ICON, kindColor } from "#lib/tree/kinds.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { activeIndex } from "#lib/index/index.svelte.ts";
  import { snippets } from "#lib/snippets/store.svelte.ts";
  import { toText } from "#lib/snippets/vscode.ts";
  import { fuzzy, rank, type Match } from "./fuzzy.ts";
  import { closePalette, paletteOpen, paletteQuery, setPaletteQuery } from "./palette.svelte.ts";

  interface Item {
    key: string;
    icon: IconName;
    color?: string;
    title: string;
    detail: string;
    keys?: string;
    match: Match;
    /** Hits apply to the title (commands) or to the detail path (files). */
    on: "title" | "detail";
    /** Left padding steps (outline depth). */
    indent?: number;
    /** `alt` = Shift+Enter (labels: insert \ref, library: open the .bib). */
    run: (alt: boolean) => void;
  }

  const open = $derived(paletteOpen());
  const query = $derived(paletteQuery());
  const mode = $derived(query.startsWith(">") ? "cmd" : query.startsWith("$") ? "snippets" : query.startsWith("@") ? "sections" : query.startsWith("#") ? "labels" : query.startsWith("&") ? "bib" : "files");
  const q = $derived(mode === "files" ? query : query.slice(1));

  let files = $state<string[]>([]);
  let sel = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();

  // Fresh file list each time the window opens (cheap: one walk in Rust).
  $effect(() => {
    if (!open) return;
    sel = 0;
    void tick().then(() => input?.focus());
    const p = currentProject();
    if (!p) return;
    void call<{ path: string; dir: boolean }[]>("fs_files", { pid: p.id })
      .then((es) => (files = es.filter((e) => !e.dir).map((e) => e.path)))
      .catch(() => (files = []));
  });

  function rel(path: string): string {
    const p = currentProject();
    if (!p) return path;
    const root = p.roots.find((r) => path.startsWith(r + "/") || path.startsWith(r + "\\"));
    if (!root) return path;
    const r = path.slice(root.length + 1);
    return p.roots.length > 1 ? `${root.split(/[\\/]/).pop()}/${r}` : r;
  }

  const items: Item[] = $derived.by(() => {
    if (mode === "cmd") {
      const cmds = allCommands().filter((c) => c.palette !== false);
      return rank<Command>(cmds, q, (c) => c.title).map(({ item: c, match }) => ({
        key: c.id,
        icon: c.icon ?? "keyboard",
        title: c.title,
        detail: c.group ?? "",
        keys: keysOf(c.id),
        match,
        on: "title" as const,
        run: () => void c.run(),
      }));
    }
    if (mode === "snippets") {
      // Title or prefix ("tabl", "bf"); highlight only title hits.
      const out: { it: Item; score: number }[] = [];
      for (const sn of snippets()) {
        const t = fuzzy(q, sn.title);
        const pf = fuzzy(q, sn.prefix);
        const best = t && (!pf || t.score >= pf.score) ? t : pf;
        if (!best) continue;
        const preview = toText(sn.body).replace(/\s+/g, " ").trim();
        out.push({
          score: best.score,
          it: {
            key: sn.id,
            icon: sn.icon,
            title: sn.title,
            detail: preview,
            keys: sn.prefix,
            match: { score: best.score, hits: best === t ? t.hits : [] },
            on: "title",
            run: () => {
              showCol("mid");
              editor()?.insertSnippet(sn.body);
            },
          },
        });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, 60).map((x) => x.it);
    }
    if (mode === "sections" || mode === "labels" || mode === "bib") return indexItems(mode, q);
    if (mode !== "files") return [];
    const recent = wsGet<string[]>("editor.recent", []).filter((p) => files.includes(p));
    const ordered = [...recent, ...files.filter((f) => !recent.includes(f))];
    return rank(ordered, q, rel).map(({ item: path, match }) => {
      const name = path.split(/[\\/]/).pop() ?? path;
      const k = fileKind(name);
      return {
        key: path,
        icon: KIND_ICON[k],
        color: kindColor(k),
        title: name,
        detail: rel(path),
        match,
        on: "detail" as const,
        run: () => {
          showCol("mid");
          void editor()?.open(path, { focus: true });
        },
      };
    });
  });

  function go(file: string, line: number): void {
    showCol("mid");
    void editor()?.reveal(file, line);
  }

  function indexItems(m: "sections" | "labels" | "bib", query: string): Item[] {
    const snap = activeIndex()?.snap;
    if (!snap) return [];
    if (m === "sections") {
      const top = Math.min(5, ...snap.outline.map((o) => o.level));
      return rank(snap.outline, query, (o) => o.title).map(({ item: o, match }) => ({
        key: `${o.file}:${o.line}`,
        icon: "heading" as const,
        title: o.title || "(bez tytułu)",
        detail: `${rel(o.file)}:${o.line}`,
        match,
        on: "title" as const,
        indent: query.trim() ? 0 : o.level - top,
        run: () => go(o.file, o.line),
      }));
    }
    if (m === "labels") {
      return rank(snap.labels, query, (l) => l.key).map(({ item: l, match }) => ({
        key: `${l.file}:${l.line}:${l.key}`,
        icon: "link" as const,
        title: l.key,
        detail: l.context || `${rel(l.file)}:${l.line}`,
        keys: "⇧↵ \\ref",
        match,
        on: "title" as const,
        run: (alt) => (alt ? void editor()?.insertText(`\\ref{${l.key}}`) : go(l.file, l.line)),
      }));
    }
    const text = (b: (typeof snap.bib)[number]) => `${b.key} ${b.authors} ${b.year} ${b.title}`;
    return rank(snap.bib, query, text).map(({ item: b, match }) => ({
      key: `${b.file}:${b.key}`,
      icon: "quote" as const,
      title: b.key,
      detail: [b.authors.split(";")[0], b.year, b.title].filter(Boolean).join(" · "),
      keys: "⇧↵ .bib",
      // Hits are computed on the whole text; only the key part is highlighted.
      match: { score: match.score, hits: match.hits.filter((h) => h < b.key.length) },
      on: "title" as const,
      run: (alt) => (alt ? go(b.file, b.line) : void editor()?.insertText(`\\cite{${b.key}}`)),
    }));
  }

  $effect(() => {
    void items.length;
    sel = 0;
  });

  function choose(i: number, alt = false): void {
    const it = items[i];
    if (!it) return;
    closePalette();
    // After the window is gone, so focus lands where the command puts it.
    void tick().then(() => it.run(alt));
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      if (!n) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      void tick().then(() => list?.querySelector(".item.sel")?.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel, e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  }

  /** Text split into plain and highlighted runs. */
  function runs(text: string, hits: number[]): { t: string; on: boolean }[] {
    const set = new Set(hits);
    const out: { t: string; on: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
      const on = set.has(i);
      if (out.length && out[out.length - 1].on === on) out[out.length - 1].t += text[i];
      else out.push({ t: text[i], on });
    }
    return out;
  }
  const PH: Record<string, string> = { files: "nazwa pliku…  (> komendy)", cmd: "komenda…", snippets: "snippet — np. tabl, równanie…", sections: "sekcja…", labels: "etykieta…", bib: "pozycja bibliografii — autor, rok, tytuł…" };
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={closePalette}>
    <div class="pal" role="dialog" aria-label="Paleta" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="field">
        <Icon name={mode === "cmd" ? "keyboard" : mode === "snippets" ? "snippet" : mode === "sections" ? "heading" : mode === "labels" ? "link" : mode === "bib" ? "quote" : "search"} size={15} />
        <input bind:this={input} value={query} oninput={(e) => setPaletteQuery(e.currentTarget.value)} onkeydown={onKey} placeholder={PH[mode]} spellcheck="false" />
      </div>
      <div class="list" bind:this={list}>
        {#each items as it, i (it.key)}
          <button class="item" class:sel={i === sel} style:padding-left={it.indent ? `${10 + it.indent * 14}px` : undefined} onmousemove={() => (sel = i)} onclick={() => choose(i)}>
            <span class="ic" style:color={it.color}><Icon name={it.icon} size={15} /></span>
            <span class="title">
              {#if it.on === "title"}{#each runs(it.title, it.match.hits) as r, k (k)}<span class:hit={r.on}>{r.t}</span>{/each}{:else}{it.title}{/if}
            </span>
            <span class="detail">
              {#if it.on === "detail"}{#each runs(it.detail, it.match.hits) as r, k (k)}<span class:hit={r.on}>{r.t}</span>{/each}{:else}{it.detail}{/if}
            </span>
            {#if it.keys}<kbd>{mode === "snippets" || mode === "labels" || mode === "bib" ? it.keys : formatKeys(it.keys)}</kbd>{/if}
          </button>
        {:else}
          <div class="empty"><Icon name={mode === "sections" || mode === "labels" || mode === "bib" ? "info" : "search"} size={18} /></div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: var(--shade);
  }
  .pal {
    width: min(620px, 92vw);
    max-height: 62vh;
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
  .list {
    overflow: auto;
    padding: 4px;
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--fs-md);
  }
  .item.sel {
    background: var(--accent-a10);
  }
  .ic {
    display: flex;
    color: var(--text-dim-2);
  }
  .item.sel .ic {
    color: var(--accent);
  }
  .title {
    color: var(--text);
    white-space: nowrap;
  }
  .detail {
    flex: 1;
    min-width: 0;
    color: var(--text-dim-3);
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hit {
    color: var(--accent);
    font-weight: 600;
  }
  kbd {
    font-family: var(--font);
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    padding: 1px 6px;
    border: 1px solid var(--line-3);
    border-radius: 4px;
  }
  .empty {
    display: flex;
    justify-content: center;
    padding: 18px;
    color: var(--text-dim-4);
  }
</style>
