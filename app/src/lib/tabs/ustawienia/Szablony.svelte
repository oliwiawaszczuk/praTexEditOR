<script lang="ts">
  // Ustawienia › Szablony: every template for "Nowy projekt" — built-in (preview only,
  // duplicate to change) and the user's own (rename, edit files, add / remove files,
  // choose the main file, delete). Edits save shortly after the last keystroke.
  import { onDestroy, onMount } from "svelte";
  import { templatesList, type TemplateInfo } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import { confirmAction, promptText, showError } from "#lib/ui/dialogs.svelte.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  interface TFile {
    path: string;
    size: number;
    dir: boolean;
  }

  let list = $state<TemplateInfo[]>([]);
  let selId = $state<string | null>(null);
  let files = $state<TFile[]>([]);
  let filePath = $state<string | null>(null);
  let text = $state("");
  let readError = $state("");
  let name = $state("");
  let pending: { id: string; path: string; text: string } | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let renameTimer: ReturnType<typeof setTimeout> | null = null;

  const sel = $derived(list.find((t) => t.id === selId) ?? null);
  const builtin = $derived(list.filter((t) => !t.custom));
  const own = $derived(list.filter((t) => t.custom));
  const editable = $derived(!!sel?.custom && !readError);

  async function reload(): Promise<void> {
    list = await templatesList().catch(() => []);
  }

  onMount(async () => {
    await reload();
    if (list[0]) await pick(list[0].id);
  });
  onDestroy(() => void flush());

  async function flush(): Promise<void> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = null;
    // Only what was actually typed, to the template and file it was typed in: after a
    // switch `sel` / `filePath` already point elsewhere.
    const p = pending;
    pending = null;
    if (p) await call("template_write", p).catch((e) => showError("Nie udało się zapisać szablonu", e));
  }

  async function pick(id: string): Promise<void> {
    await flush();
    selId = id;
    const t = list.find((x) => x.id === id);
    name = t?.name ?? "";
    files = await call<TFile[]>("template_files", { id }).catch(() => []);
    const first = files.find((f) => f.path === t?.main) ?? files.find((f) => !f.dir);
    await openFile(first?.path ?? null);
  }

  async function openFile(path: string | null): Promise<void> {
    await flush();
    filePath = path;
    text = "";
    readError = "";
    if (!path || !selId) return;
    try {
      text = await call<string>("template_read", { id: selId, path });
    } catch (e) {
      readError = String(e instanceof Error ? e.message : e);
    }
  }

  function edited(): void {
    if (!editable || !selId || !filePath) return;
    pending = { id: selId, path: filePath, text };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), 500);
  }

  function renamed(): void {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = setTimeout(async () => {
      renameTimer = null;
      if (!sel?.custom || !name.trim()) return;
      try {
        await call("template_rename", { id: sel.id, name: name.trim() });
        await reload();
      } catch (e) {
        void showError("Nie udało się zmienić nazwy", e);
      }
    }, 500);
  }

  async function create(from: string | null): Promise<void> {
    const base = from ? list.find((t) => t.id === from)?.name : null;
    const n = await promptText(base ? `Nazwa kopii „${base}”` : "Nazwa nowego szablonu", { value: base ? `${base} (kopia)` : "", confirmText: "Utwórz" });
    if (!n?.trim()) return;
    try {
      await flush();
      const id = await call<string>("template_create", { name: n.trim(), from });
      await reload();
      await pick(id);
    } catch (e) {
      void showError("Nie udało się utworzyć szablonu", e);
    }
  }

  async function remove(): Promise<void> {
    if (!sel?.custom) return;
    if (!(await confirmAction("Usunąć szablon?", `„${sel.name}” — projekty utworzone z niego zostają.`, { confirmText: "Usuń", danger: true }))) return;
    const id = sel.id;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    pending = null;
    try {
      await call("template_delete", { id });
      selId = null;
      filePath = null;
      await reload();
      if (list[0]) await pick(list[0].id);
    } catch (e) {
      void showError("Nie udało się usunąć szablonu", e);
    }
  }

  async function addFile(): Promise<void> {
    if (!sel?.custom) return;
    const p = await promptText("Nowy plik w szablonie", { label: "ścieżka, np. rozdzialy/01-wstep.tex", confirmText: "Dodaj" });
    if (!p?.trim()) return;
    try {
      await flush();
      await call("template_write", { id: sel.id, path: p.trim(), text: "" });
      files = await call<TFile[]>("template_files", { id: sel.id });
      await openFile(p.trim());
    } catch (e) {
      void showError("Nie udało się dodać pliku", e);
    }
  }

  async function addDir(): Promise<void> {
    if (!sel?.custom) return;
    const p = await promptText("Nowy folder w szablonie", { label: "ścieżka, np. img albo rozdzialy/dodatki", confirmText: "Dodaj" });
    if (!p?.trim()) return;
    try {
      await call("template_add_dir", { id: sel.id, path: p.trim() });
      files = await call<TFile[]>("template_files", { id: sel.id });
    } catch (e) {
      void showError("Nie udało się dodać folderu", e);
    }
  }

  async function removeFile(path: string): Promise<void> {
    if (!sel?.custom) return;
    const isDir = files.find((f) => f.path === path)?.dir;
    if (!(await confirmAction(isDir ? "Usunąć folder z szablonu?" : "Usunąć plik z szablonu?", isDir ? `${path} — razem z zawartością` : path, { confirmText: "Usuń", danger: true }))) return;
    try {
      if (path === filePath || (isDir && filePath?.startsWith(path + "/"))) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        pending = null;
        filePath = null;
      }
      await call("template_remove_file", { id: sel.id, path });
      files = await call<TFile[]>("template_files", { id: sel.id });
      if (!filePath) await openFile(files.find((f) => !f.dir)?.path ?? null);
    } catch (e) {
      void showError("Nie udało się usunąć pliku", e);
    }
  }

  async function setMain(path: string): Promise<void> {
    if (!sel?.custom) return;
    try {
      await call("template_set_main", { id: sel.id, path });
      await reload();
      toast("Ustawiono plik główny szablonu", { icon: "star" });
    } catch (e) {
      void showError("Nie udało się ustawić pliku głównego", e);
    }
  }

  const depth = (p: string) => p.split("/").length - 1;
  const leaf = (p: string) => p.split("/").pop() ?? p;
  const size = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);
</script>

<div class="wrap">
  <aside class="side">
    <div class="top">
      <span class="ttl">Szablony</span>
      <button class="icon-btn" use:tip={"Nowy, pusty szablon"} onclick={() => void create(null)}><Icon name="plus" size={15} /></button>
      <button class="icon-btn" disabled={!sel} use:tip={"Duplikuj zaznaczony"} onclick={() => void create(selId)}><Icon name="duplicate" size={15} /></button>
    </div>
    <div class="list">
      <div class="gh">WBUDOWANE</div>
      {#each builtin as t (t.id)}
        <button class="item" class:sel={t.id === selId} onclick={() => void pick(t.id)}>
          <Icon name={t.icon as IconName} size={14} /><span class="t">{t.name}</span>
        </button>
      {/each}
      <div class="gh">WŁASNE</div>
      {#each own as t (t.id)}
        <button class="item" class:sel={t.id === selId} onclick={() => void pick(t.id)}>
          <Icon name="folder" size={14} /><span class="t">{t.name}</span>
        </button>
      {:else}
        <div class="none">Brak — „Zapisz projekt jako szablon…” w palecie albo + powyżej</div>
      {/each}
    </div>
  </aside>

  <section class="ed">
    {#if sel}
      <div class="row">
        {#if sel.custom}
          <input class="input title" bind:value={name} oninput={renamed} spellcheck="false" />
          <button class="icon-btn danger" use:tip={"Usuń szablon"} onclick={() => void remove()}><Icon name="trash" size={15} /></button>
        {:else}
          <span class="title ro">{sel.name}</span>
          <span class="badge">wbudowany — tylko podgląd</span>
          <button class="btn" onclick={() => void create(sel.id)}><Icon name="duplicate" size={13} /> Duplikuj, aby edytować</button>
        {/if}
      </div>

      <div class="cols">
        <div class="files">
          <div class="fh">
            <span>Pliki</span>
            {#if sel.custom}
              <span class="fa">
                <button class="icon-btn" use:tip={"Nowy folder"} onclick={() => void addDir()}><Icon name="folderPlus" size={14} /></button>
                <button class="icon-btn" use:tip={"Nowy plik"} onclick={() => void addFile()}><Icon name="plus" size={14} /></button>
              </span>
            {/if}
          </div>
          {#each files as f (f.path)}
            <div class="file" class:sel={f.path === filePath}>
              {#if f.dir}
                <span class="fname dir" style:padding-left="{8 + depth(f.path) * 12}px"><Icon name="folder" size={13} /><span class="t">{leaf(f.path)}</span></span>
              {:else}
                <button class="fname" style:padding-left="{8 + depth(f.path) * 12}px" use:tip={f.path} onclick={() => void openFile(f.path)}>
                  <Icon name="file" size={13} /><span class="t">{leaf(f.path)}</span><small>{size(f.size)}</small>
                </button>
                <button class="icon-btn mini" class:on={f.path === sel.main} disabled={!sel.custom} use:tip={f.path === sel.main ? "Plik główny" : "Ustaw jako główny"} onclick={() => void setMain(f.path)}>
                  <Icon name="star" size={13} />
                </button>
              {/if}
              {#if sel.custom}<button class="icon-btn mini danger" use:tip={"Usuń plik"} onclick={() => void removeFile(f.path)}><Icon name="close" size={13} /></button>{/if}
            </div>
          {/each}
        </div>

        <div class="view">
          {#if readError}
            <div class="empty"><Icon name="alert" size={22} /><span>{readError}</span></div>
          {:else if filePath}
            <textarea class="input code" bind:value={text} oninput={edited} readonly={!editable} spellcheck="false" aria-label={filePath}></textarea>
          {:else}
            <div class="empty"><Icon name="file" size={36} /></div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty"><Icon name="template" size={48} /></div>
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
    width: 260px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line-1);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 12px;
  }
  .ttl {
    flex: 1;
    font-weight: 600;
    color: var(--text);
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 16px;
  }
  .gh {
    margin: 12px 8px 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-dim-3);
  }
  .none {
    margin: 6px 8px;
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
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
  .t {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ed {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 28px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    flex: 1;
    font-size: var(--fs-lg);
  }
  .title.ro {
    font-weight: 600;
    color: var(--text);
  }
  .badge {
    padding: 2px 10px;
    font-size: var(--fs-xs);
    color: var(--text-dim-2);
    border: 1px solid var(--line-3);
    border-radius: 999px;
  }
  .danger:hover {
    color: var(--danger);
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
  }
  .files {
    width: 250px;
    flex-shrink: 0;
    overflow: auto;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 4px;
  }
  .fh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim-3);
  }
  .file {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .file.sel {
    background: var(--accent-a10);
  }
  .fname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: var(--fs-sm);
    text-align: left;
    color: var(--text-dim-2);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .fname.dir {
    cursor: default;
    color: var(--text-dim-3);
  }
  .fa {
    display: flex;
  }
  .fname small {
    color: var(--text-dim-4);
  }
  .mini {
    opacity: 0.5;
  }
  .file:hover .mini,
  .mini.on {
    opacity: 1;
  }
  .mini.on {
    color: var(--accent);
  }
  .view {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .code {
    flex: 1;
    resize: none;
    font-family: var(--font);
    font-size: var(--fs-sm);
    line-height: 1.55;
    white-space: pre;
    tab-size: 2;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-dim-4);
  }
</style>
