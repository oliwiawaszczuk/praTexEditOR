<script lang="ts">
  // Ustawienia › Snippety (docs/03-ux.md §7): list on the left (groups, icons), editor
  // on the right: prefix, shortcut, icon (grid), body with a live preview of what gets
  // inserted ($1… fields marked), "show on the Wstaw bar". Changes save at once.
  // Built-ins can be changed (↺ back to the original) or hidden; import from VS Code.
  import { onDestroy } from "svelte";
  import { call } from "#lib/core/tauri.ts";
  import { GROUPS, type Snippet, type SnippetGroup } from "#lib/snippets/builtin.ts";
  import { builtinOf, commandId, hiddenBuiltins, importVsCodeSnippets, isBuiltin, isChanged, newId, removeSnippet, resetSnippet, saveSnippet, snippets } from "#lib/snippets/store.svelte.ts";
  import { fieldsOf, toText } from "#lib/snippets/vscode.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import KeyRecorder from "#lib/ui/KeyRecorder.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import Toggle from "#lib/ui/Toggle.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  const ICONS: IconName[] = ["snippet", "bold", "italic", "underline", "heading", "listBullet", "listNumber", "sigma", "image", "table", "quote", "link", "env", "func", "note", "tex", "bib", "slides", "layout", "file", "star", "data", "target", "edit"];

  let selId = $state<string | null>(null);
  let filter = $state("");
  let draft = $state<Snippet | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const all = $derived(snippets());
  const groups = $derived(
    GROUPS.map((g) => ({ g, list: all.filter((s) => s.group === g.id && (!filter || s.title.toLowerCase().includes(filter.toLowerCase()) || s.prefix.includes(filter))) })).filter((x) => x.list.length),
  );
  const prefixClash = $derived(draft ? all.some((s) => s.id !== draft?.id && s.prefix === draft?.prefix) : false);

  function pick(id: string): void {
    flush();
    selId = id;
    const s = all.find((x) => x.id === id);
    draft = s ? { ...s } : null;
  }

  // Edits save shortly after the last keystroke (no "Save" button anywhere).
  function changed(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (draft && draft.prefix.trim() && draft.title.trim()) void saveSnippet($state.snapshot(draft) as Snippet);
  }
  onDestroy(flush);

  async function add(): Promise<void> {
    flush();
    const s: Snippet = { id: newId("nowy"), title: "Nowy snippet", prefix: `nowy${all.length}`, body: "\\textbf{${1:$TM_SELECTED_TEXT}}$0", group: "własne", icon: "snippet" };
    await saveSnippet(s);
    pick(s.id);
  }

  async function remove(): Promise<void> {
    if (!draft) return;
    const id = draft.id;
    draft = null;
    selId = null;
    await removeSnippet(id);
    toast(isBuiltin(id) ? "Ukryto wbudowany snippet (można przywrócić niżej)" : "Usunięto snippet", { icon: "trash" });
  }

  async function reset(): Promise<void> {
    if (!draft) return;
    const id = draft.id;
    await resetSnippet(id);
    draft = { ...(builtinOf(id) as Snippet) };
  }

  async function importFile(): Promise<void> {
    try {
      const json = await call<unknown>("import_json_file", { title: "Plik snippetów z VS Code (np. latex.json)" });
      if (json === null) return;
      const n = await importVsCodeSnippets(json);
      toast(n ? `Zaimportowano ${n} snippetów do grupy „Własne”` : "W pliku nie ma snippetów", { icon: "snippet" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  /** Preview runs: inserted text with the fields marked. */
  const preview = $derived.by(() => {
    if (!draft) return [];
    const text = toText(draft.body, { selection: "" });
    const f = fieldsOf(draft.body, { selection: "" });
    const out: { t: string; field: number | null }[] = [];
    let pos = 0;
    for (const x of f) {
      if (x.from > pos) out.push({ t: text.slice(pos, x.from), field: null });
      out.push({ t: text.slice(x.from, x.to) || "│", field: x.n });
      pos = x.to;
    }
    if (pos < text.length) out.push({ t: text.slice(pos), field: null });
    return out;
  });
</script>

<div class="wrap">
  <aside class="side">
    <div class="top">
      <input class="input" bind:value={filter} placeholder="filtr…" spellcheck="false" />
      <button class="icon-btn" use:tip={"Nowy snippet"} onclick={() => void add()}><Icon name="plus" size={15} /></button>
      <button class="icon-btn" use:tip={"Import z VS Code (.json)"} onclick={() => void importFile()}><Icon name="download" size={15} /></button>
    </div>
    <div class="list">
      {#each groups as { g, list } (g.id)}
        <div class="gh"><Icon name={g.icon} size={12} /> {g.label}</div>
        {#each list as s (s.id)}
          <button class="item" class:sel={s.id === selId} onclick={() => pick(s.id)}>
            <Icon name={s.icon} size={14} />
            <span class="t">{s.title}</span>
            {#if isChanged(s.id)}<span class="dot" use:tip={"zmieniony"}></span>{/if}
            <code>{s.prefix}</code>
          </button>
        {/each}
      {/each}
      {#if hiddenBuiltins().length}
        <div class="gh"><Icon name="trash" size={12} /> Ukryte</div>
        {#each hiddenBuiltins() as s (s.id)}
          <button class="item hidden" use:tip={"Przywróć"} onclick={() => void resetSnippet(s.id)}>
            <Icon name="undo" size={13} />
            <span class="t">{s.title}</span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="ed">
    {#if draft}
      <div class="row">
        <input class="input title" bind:value={draft.title} oninput={changed} spellcheck="false" />
        {#if isChanged(draft.id)}<button class="icon-btn" use:tip={"Przywróć wbudowany"} onclick={() => void reset()}><Icon name="undo" size={15} /></button>{/if}
        <button class="icon-btn danger" use:tip={isBuiltin(draft.id) ? "Ukryj" : "Usuń"} onclick={() => void remove()}><Icon name="trash" size={15} /></button>
      </div>
      <div class="grid">
        <span class="lbl">prefiks</span>
        <span class="fld">
          <input class="input pre" class:bad={prefixClash} bind:value={draft.prefix} oninput={changed} spellcheck="false" />
          <span class="hint">{prefixClash ? "ten prefiks już jest" : "wpisz i naciśnij Tab"}</span>
        </span>
        <span class="lbl">skrót</span>
        <span class="fld"><KeyRecorder id={commandId(draft.id)} when="editorFocus" fallback={draft.keys} /></span>
        <span class="lbl">grupa</span>
        <span class="fld">
          <select class="input" bind:value={draft.group} onchange={changed}>
            {#each GROUPS as g (g.id)}<option value={g.id as SnippetGroup}>{g.label}</option>{/each}
          </select>
        </span>
        <span class="lbl">pasek „Wstaw”</span>
        <span class="fld"><Toggle label="Pokaż na pasku" on={!!draft.bar} onchange={(v) => { if (draft) draft.bar = v; changed(); }} /></span>
        <span class="lbl">ikona</span>
        <span class="fld icons">
          {#each ICONS as ic (ic)}
            <button class="ico" class:on={draft.icon === ic} onclick={() => { if (draft) draft.icon = ic; changed(); }}><Icon name={ic} size={15} /></button>
          {/each}
        </span>
      </div>
      <span class="lbl block">treść <span class="hint">$1, ${"{"}1:domyślne}, $0 = koniec, $TM_SELECTED_TEXT = zaznaczenie</span></span>
      <textarea class="input body" bind:value={draft.body} oninput={changed} spellcheck="false"></textarea>
      <span class="lbl block">podgląd</span>
      <pre class="preview">{#each preview as r, i (i)}{#if r.field !== null}<span class="f" use:tip={r.field === 0 ? "koniec" : `pole ${r.field}`}>{r.t}</span>{:else}{r.t}{/if}{/each}</pre>
    {:else}
      <div class="empty"><Icon name="snippet" size={48} /></div>
    {/if}
  </section>
</div>

<style>
  .wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    min-height: 0;
  }
  .side {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line-1);
  }
  .top {
    display: flex;
    gap: 4px;
    padding: 12px;
  }
  .top .input {
    flex: 1;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 16px;
  }
  .gh {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 8px 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-dim-3);
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    font-size: var(--fs-md);
    text-align: left;
    color: var(--text-dim-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .item:hover {
    background: var(--hover);
  }
  .item.sel {
    color: var(--accent);
    background: var(--accent-a10);
    border-color: var(--accent-a30);
  }
  .item.hidden {
    opacity: 0.6;
  }
  .t {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  code {
    font-family: var(--font);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .ed {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 28px;
    overflow: auto;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .title {
    flex: 1;
    font-size: var(--fs-lg);
  }
  .danger:hover {
    color: var(--danger);
  }
  .grid {
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: center;
    gap: 10px 14px;
  }
  .lbl {
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
  }
  .lbl.block {
    margin-top: 6px;
  }
  .fld {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pre {
    width: 140px;
    font-family: var(--font);
  }
  .pre.bad {
    border-color: var(--danger);
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
  }
  .icons {
    flex-wrap: wrap;
    gap: 3px;
  }
  .ico {
    display: inline-flex;
    padding: 5px;
    color: var(--text-dim-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ico:hover {
    background: var(--hover);
  }
  .ico.on {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .body {
    min-height: 140px;
    font-family: var(--font);
    font-size: var(--fs-md);
    line-height: 1.6;
    resize: vertical;
    -webkit-user-select: text;
    user-select: text;
  }
  .preview {
    margin: 0;
    padding: 12px 14px;
    font-family: var(--font);
    font-size: var(--fs-md);
    line-height: 1.6;
    white-space: pre-wrap;
    color: var(--text-dim-1);
    background: var(--editor-bg);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }
  .f {
    color: var(--accent);
    background: var(--accent-a10);
    outline: 1px solid var(--accent-a40);
    border-radius: 2px;
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim-4);
  }
</style>
