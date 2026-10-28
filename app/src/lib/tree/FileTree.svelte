<script lang="ts">
  // Left column: the project's files (docs/03-ux.md §3.1). Virtual list — only rows in
  // view are in the DOM, so a 10 000-file folder scrolls like a 10-file one.
  import { onDestroy, onMount, tick } from "svelte";
  import { getSetting } from "#lib/core/appSettings.svelte.ts";
  import { keysOf, register } from "#lib/core/commands.svelte.ts";
  import { currentProject, removeRoot, setRoot, type Project } from "#lib/core/projects.svelte.ts";
  import { pickDirectory } from "#lib/core/tauri.ts";
  import { activeBuild } from "#lib/build/build.svelte.ts";
  import { activeGit } from "#lib/git/git.svelte.ts";
  import { dropFiles } from "#lib/images/images.svelte.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { openMenu, type MenuEntry } from "#lib/ui/contextMenu.svelte.ts";
  import { showError } from "#lib/ui/dialogs.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { dropTarget, pressDrag } from "./dnd.svelte.ts";
  import { fileKind, KIND_ICON, kindColor } from "./kinds.ts";
  import { setActiveTree, TreeStore, type Entry, type Row } from "./tree.svelte.ts";

  const ROW = 24;
  const OVERSCAN = 8;

  const tree = new TreeStore(() => currentProject() as Project);
  setActiveTree(tree);
  onMount(() => void tree.start());
  // Tree actions are commands: palette, editable shortcuts (keys work in the tree).
  const focusedRow = () => rows.find((r) => r.path === tree.focused);
  const offCmds = register([
    { id: "tree.newFile", title: "Nowy plik", icon: "filePlus", keys: "mod+n", when: "treeFocus", group: "Pliki", run: () => void tree.startCreate(currentDir(), false) },
    { id: "tree.newFolder", title: "Nowy folder", icon: "folderPlus", keys: "mod+shift+n", when: "treeFocus", group: "Pliki", run: () => void tree.startCreate(currentDir(), true) },
    { id: "tree.rename", title: "Zmień nazwę", icon: "edit", keys: "f2", when: "treeFocus", group: "Pliki", palette: false, run: () => { const r = focusedRow(); if (!r) return false; tree.startRename(r.path); } },
    { id: "tree.trash", title: "Do kosza", icon: "trash", keys: "mod+backspace", when: "treeFocus", group: "Pliki", palette: false, run: () => { const r = focusedRow(); if (!r) return false; void tree.trash(tree.targets(r.path)); } },
    { id: "tree.find", title: "Szukaj pliku w drzewie", icon: "search", group: "Pliki", run: () => void toggleFilter() },
    { id: "tree.collapseAll", title: "Zwiń wszystkie foldery", icon: "collapse", group: "Pliki", run: () => tree.collapseAll() },
    { id: "tree.addRoot", title: "Podepnij folder do projektu", icon: "link", group: "Pliki", run: () => void addRoot() },
  ]);
  onDestroy(() => {
    offCmds();
    tree.stop();
    setActiveTree(null);
  });

  // Visibility settings changed in Ustawienia → re-read loaded folders.
  let visKey = "";
  $effect(() => {
    const k = `${getSetting("tree.showHidden", false)}|${getSetting("tree.showAux", false)}`;
    if (visKey && k !== visKey) void tree.reloadAll();
    visKey = k;
  });

  let scroller = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(400);
  let filterOpen = $state(false);
  let filterInput = $state<HTMLInputElement>();

  const project = $derived(currentProject() as Project);
  const gitMarks = $derived(activeGit()?.marks);
  const gitDirs = $derived(activeGit()?.dirtyDirs);
  const rows = $derived(tree.rows);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN));
  const last = $derived(Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN));
  const visible = $derived(rows.slice(first, last));
  const over = $derived(dropTarget());

  function isMain(path: string): boolean {
    return project.main === path;
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────

  function onRowClick(e: MouseEvent, r: Row): void {
    if (r.input) return;
    const mode = e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "single";
    tree.select(r.path, mode);
    if (mode === "single" && r.dir && !r.missing) tree.toggle(r.path);
    // Single click = preview tab (replaced by the next one), like VS Code.
    if (mode === "single" && !r.dir) void editor()?.open(r.path, { preview: true });
    scroller?.focus();
  }

  function onRowDblClick(r: Row): void {
    if (!r.dir && !r.input) void editor()?.open(r.path, { focus: true });
  }

  function onRowDown(e: PointerEvent, r: Row): void {
    if (r.input || r.root !== undefined || tree.editing?.mode === "rename") return;
    const items = tree.targets(r.path);
    pressDrag(e, {
      items,
      label: items.length === 1 ? r.name : `${items.length} elementy`,
      scroller,
      onHoverExpand: (dir) => void tree.expand(dir),
      // Onto the editor: reference the file there (image → \includegraphics, .tex → \input).
      onDrop: (items, target, copy, at) => void (target === "@editor" ? dropFiles(items, at) : tree.transfer(items, target, copy)),
    });
  }

  function onContext(e: MouseEvent, r: Row): void {
    if (r.input) return;
    if (!tree.selected.has(r.path)) tree.select(r.path);
    const dir = r.dropDir;
    const targets = tree.targets(r.path);
    const many = targets.length > 1;
    const items: MenuEntry[] = [
      { icon: "filePlus", label: "Nowy plik", keys: keysOf("tree.newFile"), run: () => void tree.startCreate(dir, false) },
      { icon: "folderPlus", label: "Nowy folder", keys: keysOf("tree.newFolder"), run: () => void tree.startCreate(dir, true) },
      "sep",
    ];
    if (r.root !== undefined) {
      if (r.missing) items.push({ icon: "folderOpen", label: "Wskaż folder ponownie", run: () => void relink(r.path) });
      items.push(
        { icon: "reveal", label: "Pokaż w Finderze", disabled: r.missing, run: () => tree.revealInOs(r.path) },
        {
          icon: "unlink",
          label: "Odłącz od projektu",
          disabled: project.roots.length < 2,
          run: () => void detach(r.path),
        },
      );
    } else {
      if (!r.dir && fileKind(r.name) === "tex")
        items.push({ icon: "star", label: "Ustaw jako plik główny", disabled: isMain(r.path), run: () => void tree.setMain(r.path) });
      items.push(
        { icon: "edit", label: "Zmień nazwę", keys: keysOf("tree.rename"), disabled: many, run: () => tree.startRename(r.path) },
        { icon: "duplicate", label: "Duplikuj", disabled: many, run: () => void tree.duplicate(r.path) },
        { icon: "copy", label: "Kopiuj ścieżkę względną", disabled: many, run: () => void copyRel(r.path) },
        { icon: "reveal", label: "Pokaż w Finderze", disabled: many, run: () => tree.revealInOs(r.path) },
        "sep",
        { icon: "trash", label: many ? `Do kosza (${targets.length})` : "Do kosza", keys: keysOf("tree.trash"), danger: true, run: () => void tree.trash(targets) },
      );
    }
    openMenu(e, items);
  }

  async function copyRel(path: string): Promise<void> {
    const rel = tree.relPath(path);
    await navigator.clipboard.writeText(rel);
    toast(`Skopiowano: ${rel}`, { icon: "copy" });
  }

  async function addRoot(): Promise<void> {
    const dir = await pickDirectory("Podepnij folder do projektu");
    if (!dir) return;
    try {
      await setRoot(project.id, dir);
      await tree.load(project.roots[project.roots.length - 1]);
    } catch (e) {
      void showError("Nie udało się podpiąć folderu", e);
    }
  }

  async function relink(old: string): Promise<void> {
    const dir = await pickDirectory("Gdzie jest teraz ten folder?");
    if (!dir) return;
    try {
      await setRoot(project.id, dir, old);
      const now = project.roots.find((r) => !tree.children.has(r));
      if (now) await tree.expand(now);
    } catch (e) {
      void showError("Nie udało się podpiąć folderu", e);
    }
  }

  async function detach(path: string): Promise<void> {
    try {
      await removeRoot(project.id, path);
      toast("Folder odłączony (pliki zostały na dysku)", { icon: "unlink" });
    } catch (e) {
      void showError("Nie udało się odłączyć folderu", e);
    }
  }

  /** New file/folder lands in the focused folder (or the focused file's folder). */
  function currentDir(): string {
    const r = rows.find((x) => x.path === tree.focused);
    return r?.dropDir ?? project.roots[0];
  }

  // ── Keyboard (tree focused) ────────────────────────────────────────────────

  function scrollIntoView(path: string): void {
    const i = rows.findIndex((r) => r.path === path);
    if (i < 0 || !scroller) return;
    const top = i * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW > scroller.scrollTop + height) scroller.scrollTop = top + ROW - height;
  }

  function onKey(e: KeyboardEvent): void {
    // Commands (⌘N, F2, ⌘⌫…) were dispatched already, in the capture phase.
    if (tree.editing || e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    const i = rows.findIndex((r) => r.path === tree.focused);
    const r = rows[i];
    const go = (j: number) => {
      const t = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!t) return;
      tree.select(t.path, e.shiftKey ? "range" : "single");
      scrollIntoView(t.path);
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? 0 : i - 1);
    else if (e.key === "ArrowRight" && r?.dir) {
      if (!tree.expanded.has(r.path)) void tree.expand(r.path);
      else go(i + 1);
    } else if (e.key === "ArrowLeft" && r) {
      if (r.dir && tree.expanded.has(r.path)) tree.collapse(r.path);
      else {
        const parent = rows.slice(0, i).findLast((x) => x.depth < r.depth);
        if (parent) go(rows.indexOf(parent));
      }
    } else if (e.key === "Enter" && r) {
      if (r.dir) tree.toggle(r.path);
      else void editor()?.open(r.path, { focus: true });
    } else if (e.key === "Delete") {
      if (r) void tree.trash(tree.targets(r.path));
    } else if (e.key.toLowerCase() === "a" && mod) {
      for (const x of rows) if (x.root === undefined && !x.input) tree.selected.add(x.path);
    } else if (e.key === "Escape") tree.selected.clear();
    else return;
    e.preventDefault();
  }

  // ── Inline input ───────────────────────────────────────────────────────────

  function editInit(node: HTMLInputElement, value: string): void {
    node.value = value;
    void tick().then(() => {
      node.focus();
      // Select the name without the extension, like Finder; a bare ".tex" suggestion
      // keeps the caret before it, so typing "wstep" gives "wstep.tex".
      const dot = value.lastIndexOf(".");
      node.setSelectionRange(0, dot >= 0 ? dot : value.length);
    });
  }

  function editKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void tree.commitEdit((e.currentTarget as HTMLInputElement).value).then(() => scroller?.focus());
    } else if (e.key === "Escape") {
      e.preventDefault();
      tree.cancelEdit();
      scroller?.focus();
    }
  }

  function editBlur(e: FocusEvent): void {
    if (tree.editing) void tree.commitEdit((e.currentTarget as HTMLInputElement).value);
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  async function toggleFilter(): Promise<void> {
    filterOpen = !filterOpen;
    if (filterOpen) {
      await tick();
      filterInput?.focus();
    } else void tree.search("");
  }

  async function pickResult(e: Entry): Promise<void> {
    filterOpen = false;
    void tree.search("");
    await tree.reveal(e.path);
    await tick();
    scrollIntoView(e.path);
  }
</script>

<div class="tree">
  <header>
    <span class="title">Pliki</span>
    <button class="icon-btn" use:tip={{ label: "Nowy plik", keys: keysOf("tree.newFile") }} onclick={() => void tree.startCreate(currentDir(), false)}>
      <Icon name="filePlus" size={15} />
    </button>
    <button class="icon-btn" use:tip={{ label: "Nowy folder", keys: keysOf("tree.newFolder") }} onclick={() => void tree.startCreate(currentDir(), true)}>
      <Icon name="folderPlus" size={15} />
    </button>
    <button class="icon-btn" class:on={filterOpen} use:tip={"Szukaj pliku"} onclick={toggleFilter}>
      <Icon name="search" size={15} />
    </button>
    <button class="icon-btn" use:tip={"Zwiń wszystko"} onclick={() => tree.collapseAll()}>
      <Icon name="collapse" size={15} />
    </button>
    <button class="icon-btn" use:tip={"Podepnij folder"} onclick={addRoot}>
      <Icon name="link" size={15} />
    </button>
  </header>

  {#if filterOpen}
    <div class="filter">
      <input
        class="input"
        bind:this={filterInput}
        placeholder="nazwa pliku…"
        spellcheck="false"
        oninput={(e) => void tree.search(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Escape") void toggleFilter();
          else if (e.key === "Enter" && tree.results?.[0]) void pickResult(tree.results[0]);
        }}
      />
    </div>
  {/if}

  {#if filterOpen && tree.results}
    <div class="results">
      {#each tree.results as e (e.path)}
        {@const k = e.dir ? null : fileKind(e.name)}
        <button class="res" onclick={() => pickResult(e)}>
          <span class="ico" style:color={k ? kindColor(k) : "var(--text-dim-2)"}><Icon name={k ? KIND_ICON[k] : "folder"} size={14} /></span>
          <span class="name">{e.name}</span>
          <span class="where">{tree.relPath(e.path).split("/").slice(0, -1).join("/")}</span>
        </button>
      {:else}
        <div class="empty-res"><Icon name="search" size={20} /></div>
      {/each}
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="body"
      bind:this={scroller}
      bind:clientHeight={height}
      onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
      onkeydown={onKey}
      tabindex="0"
      role="tree"
      data-drop={project.roots[0]}
      oncontextmenu={(e) => {
        if (e.target === e.currentTarget)
          openMenu(e, [
            { icon: "filePlus", label: "Nowy plik", run: () => void tree.startCreate(project.roots[0], false) },
            { icon: "folderPlus", label: "Nowy folder", run: () => void tree.startCreate(project.roots[0], true) },
            { icon: "link", label: "Podepnij folder", run: addRoot },
          ]);
      }}
    >
      <div class="spacer" style:height="{rows.length * ROW}px">
        {#each visible as r, k (r.key)}
          {@const kind = r.dir ? null : fileKind(r.name)}
          {@const renaming = tree.editing?.mode === "rename" && tree.editing.path === r.path}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="row"
            class:root={r.root !== undefined}
            class:sel={tree.selected.has(r.path)}
            class:focus={tree.focused === r.path}
            class:drop={over === r.dropDir && (r.dir || r.input)}
            class:dropin={over !== null && over === r.dropDir && !r.dir}
            class:missing={r.missing}
            class:flash={tree.flash === r.path}
            style:top="{(first + k) * ROW}px"
            style:padding-left="{6 + r.depth * 14}px"
            data-drop={r.dropDir}
            role="treeitem"
            aria-selected={tree.selected.has(r.path)}
            tabindex="-1"
            onclick={(e) => onRowClick(e, r)}
            ondblclick={() => onRowDblClick(r)}
            onpointerdown={(e) => onRowDown(e, r)}
            oncontextmenu={(e) => onContext(e, r)}
          >
            {#each { length: Math.max(0, r.depth - 1) } as _, g (g)}
              <span class="guide" style:left="{13 + (g + 1) * 14}px"></span>
            {/each}
            <span class="chev" class:open={tree.expanded.has(r.path)}>
              {#if r.dir && !r.input}<Icon name="chevronRight" size={12} />{/if}
            </span>
            {#if r.root !== undefined}
              <span class="dot" style:background={project.color}></span>
              <span class="ico root-ico"><Icon name={r.missing ? "alert" : tree.expanded.has(r.path) ? "folderOpen" : "folder"} size={14} /></span>
            {:else if r.dir}
              <span class="ico dir"><Icon name={tree.expanded.has(r.path) ? "folderOpen" : "folder"} size={14} /></span>
            {:else}
              <span class="ico" style:color={kindColor(kind ?? (r.input ? "tex" : "other"))}>
                <Icon name={r.input === "file" ? "filePlus" : KIND_ICON[kind ?? "other"]} size={14} />
              </span>
            {/if}
            {#if r.input || renaming}
              <input
                class="edit"
                spellcheck="false"
                use:editInit={renaming ? r.name : r.input === "file" ? ".tex" : ""}
                onkeydown={editKey}
                onblur={editBlur}
                onclick={(e) => e.stopPropagation()}
                onpointerdown={(e) => e.stopPropagation()}
              />
            {:else}
              <span class="name">{r.name}</span>
              {#if !r.dir && activeBuild()?.errorFiles.has(r.path)}<span class="failed" use:tip={"Błędy kompilacji w tym pliku"}></span>{/if}
              {#if !r.dir && editor()?.isDirty(r.path)}<span class="unsaved"></span>{/if}
              {#if gitMarks?.get(r.path)}
                {@const gk = gitMarks.get(r.path)}
                <span class="gm {gk}" use:tip={gk === "added" ? "Nowy (niezatwierdzony)" : gk === "deleted" ? "Usunięty" : "Zmieniony (niezatwierdzony)"}>{gk === "added" ? "A" : gk === "deleted" ? "D" : "M"}</span>
              {:else if r.dir && gitDirs?.has(r.path)}
                <span class="gd" use:tip={"Zawiera niezatwierdzone zmiany"}></span>
              {/if}
              {#if isMain(r.path)}
                <span class="main" use:tip={"Plik główny"}><Icon name="star" size={11} /></span>
              {/if}
              {#if r.missing}
                <button class="relink" use:tip={"Wskaż folder ponownie"} onclick={(e) => { e.stopPropagation(); void relink(r.path); }}>
                  <Icon name="folderOpen" size={13} />
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .tree {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--line-1);
    flex-shrink: 0;
  }
  .title {
    flex: 1;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim-3);
  }
  .filter {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line-1);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    outline: none;
    position: relative;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: 24px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
    font-size: var(--fs-md);
    color: var(--text-dim-1);
    cursor: default;
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.sel {
    background: var(--accent-a10);
    color: var(--text-strong);
  }
  .body:focus-within .row.focus {
    border-color: var(--accent-a30);
  }
  .row.root {
    font-weight: 600;
    color: var(--text);
  }
  .row.missing {
    color: var(--text-dim-4);
  }
  .row.drop {
    background: var(--accent-a15);
    border-color: var(--accent-a40);
  }
  .row.dropin {
    background: var(--accent-a10);
  }
  .row.flash {
    animation: flash 0.9s ease;
  }
  @keyframes flash {
    0% {
      background: var(--accent-a40);
    }
  }
  .guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line-1);
  }
  .chev {
    width: 12px;
    flex-shrink: 0;
    display: flex;
    color: var(--text-dim-3);
    transition: transform var(--t-fast);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-right: 1px;
  }
  .ico {
    display: flex;
    flex-shrink: 0;
  }
  .ico.dir,
  .root-ico {
    color: var(--text-dim-2);
  }
  .missing .root-ico {
    color: var(--danger);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .failed {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--danger);
  }
  .gm {
    flex-shrink: 0;
    margin-left: auto;
    padding-right: 4px;
    font-size: 10px;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    color: var(--accent);
  }
  .gm.added {
    color: var(--ok);
  }
  .gm.deleted {
    color: var(--danger);
  }
  .gd {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    margin-left: auto;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--accent-a70);
  }
  .unsaved {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--accent);
  }
  .main {
    display: flex;
    color: var(--accent);
    flex-shrink: 0;
  }
  .relink {
    margin-left: auto;
    display: flex;
    padding: 2px;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
  }
  .edit {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0 5px;
    font-size: var(--fs-md);
    background: var(--bg-deepest);
    border: 1px solid var(--accent-a40);
    border-radius: 4px;
    outline: none;
  }
  .results {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .res {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    font-size: var(--fs-md);
    color: var(--text-dim-1);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .res:hover {
    background: var(--hover);
    color: var(--text-strong);
  }
  .where {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-res {
    display: flex;
    justify-content: center;
    padding: 24px;
    color: var(--text-dim-4);
  }
</style>
