<script lang="ts">
  import "@fontsource/jetbrains-mono/400.css";
  import "@fontsource/jetbrains-mono/600.css";
  import "#lib/ui/tokens.css";

  import { onMount, type Component } from "svelte";
  import { flushAppSettings, getSetting, loadAppSettings } from "#lib/core/appSettings.svelte.ts";
  import { watchEngine } from "#lib/core/engine.svelte.ts";
  import { activeTab, goTo, restoreNav, type TabKey } from "#lib/core/nav.svelte.ts";
  import { dispatchKey, keysOf, register } from "#lib/core/commands.svelte.ts";
  import { loadKeybindings } from "#lib/core/keybindings.ts";
  import { loadSnippets } from "#lib/snippets/store.svelte.ts";
  import ImageDialog from "#lib/images/ImageDialog.svelte";
  import { dropFiles } from "#lib/images/images.svelte.ts";
  import Palette from "#lib/palette/Palette.svelte";
  import { openPalette } from "#lib/palette/palette.svelte.ts";
  import LibraryModal from "#lib/library/LibraryModal.svelte";
  import { openLibrary } from "#lib/library/library.svelte.ts";
  import ShortcutsModal from "#lib/palette/ShortcutsModal.svelte";
  import { openShortcuts } from "#lib/palette/shortcuts.svelte.ts";
  import { isMac } from "#lib/core/keys.ts";
  import { closeProject, currentProject, flushProject, leaveProject, loadProjects, restoreLastProject } from "#lib/core/projects.svelte.ts";
  import { call, onCloseRequested, onOsDrag, onProjectMenu } from "#lib/core/tauri.ts";
  import ContextMenuHost from "#lib/ui/ContextMenuHost.svelte";
  import ProjectChip from "#lib/ui/ProjectChip.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import NewProject from "#lib/start/NewProject.svelte";
  import { dropFolders, folderFlow, openWizard } from "#lib/start/wizard.svelte.ts";
  import DragGhost from "#lib/tree/DragGhost.svelte";
  import { osDragLeave, osDragOver, osDropTarget } from "#lib/tree/dnd.svelte.ts";
  import { activeTree } from "#lib/tree/tree.svelte.ts";
  import Projekt from "#lib/tabs/projekt/Projekt.svelte";
  import { isHidden, toggleCol, type Col } from "#lib/tabs/projekt/layout.svelte.ts";
  import DialogHost from "#lib/ui/DialogHost.svelte";
  import { promptText, showError } from "#lib/ui/dialogs.svelte.ts";
  import EngineChip from "#lib/ui/EngineChip.svelte";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import LoadingBar from "#lib/ui/LoadingBar.svelte";
  import Toasts from "#lib/ui/Toasts.svelte";
  import TooltipHost from "#lib/ui/TooltipHost.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import FloatingNotePad from "#lib/notes/FloatingNotePad.svelte";
  import { restorePad, sendToNote, togglePad } from "#lib/notes/pad.svelte.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import Tablica from "#lib/tabs/tablica/Tablica.svelte";
  import { dropOnBoard } from "#lib/tabs/tablica/board.svelte.ts";
  import Notatki from "#lib/tabs/notatki/Notatki.svelte";
  import Placeholder from "#lib/tabs/Placeholder.svelte";
  import Ustawienia from "#lib/tabs/ustawienia/Ustawienia.svelte";

  interface TabDef {
    key: TabKey;
    label: string;
    icon: IconName;
    keys: string;
    component?: Component;
    stage?: string;
  }

  const TABS: TabDef[] = [
    { key: "projekt", label: "Projekt", icon: "project", keys: "mod+1", component: Projekt },
    { key: "tablica", label: "Tablica", icon: "board", keys: "mod+2", component: Tablica },
    { key: "notatki", label: "Notatki", icon: "note", keys: "mod+3", component: Notatki },
    { key: "ustawienia", label: "Ustawienia", icon: "gear", keys: "mod+,", component: Ustawienia },
  ];

  type Boot = "booting" | "ready" | "error";
  let boot = $state<Boot>("booting");
  let errorMsg = $state("");

  const tab = $derived(activeTab());
  // Tabs mount on first visit and then stay mounted (hidden): heavy state (editor,
  // PDF canvases, board) must not be rebuilt on every switch.
  let visited = $state<Set<TabKey>>(new Set());
  $effect(() => {
    const t = tab;
    if (!visited.has(t)) visited = new Set(visited).add(t);
  });

  async function start(): Promise<void> {
    try {
      await loadAppSettings();
      await Promise.all([loadKeybindings(), loadSnippets()]);
      restoreNav();
      restorePad();
      await loadProjects();
      if (getSetting("openLastProject", true)) await restoreLastProject().catch(() => {});
      boot = "ready";
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      boot = "error";
    }
  }

  const project = $derived(currentProject());
  const COLS: { col: Col; icon: IconName; label: string; keys: string }[] = [
    { col: "left", icon: "colLeft", label: "Pliki", keys: "mod+alt+1" },
    { col: "mid", icon: "colMid", label: "Edytor", keys: "mod+alt+2" },
    { col: "right", icon: "colRight", label: "PDF", keys: "mod+alt+3" },
  ];

  // App-level commands; everything else is registered by the views that own it.
  // Project-view commands only act while that view is on screen.
  register([
    ...TABS.map((t) => ({ id: `app.tab.${t.key}`, title: t.label, icon: t.icon, keys: t.keys, group: "Okno", run: () => goTo(t.key) })),
    ...COLS.map((c) => ({
      id: `app.col.${c.col}`,
      title: `Pokaż/ukryj: ${c.label}`,
      icon: c.icon,
      keys: c.keys,
      group: "Okno",
      run: () => (project && tab === "projekt" ? toggleCol(c.col) : false),
    })),
    { id: "app.palette", title: "Paleta komend", icon: "keyboard", keys: "mod+shift+p", group: "Okno", run: () => openPalette(">") },
    { id: "app.snippets", title: "Wstaw snippet…", icon: "snippet", keys: "mod+shift+s", group: "Okno", run: () => (project && tab === "projekt" ? openPalette("$") : false) },
    { id: "app.outline", title: "Sekcje dokumentu", icon: "heading", keys: "mod+shift+o", group: "Okno", run: () => (project && tab === "projekt" ? openPalette("@") : false) },
    { id: "app.labels", title: "Etykiety", icon: "link", keys: "mod+t", group: "Okno", run: () => (project && tab === "projekt" ? openPalette("#") : false) },
    { id: "app.library", title: "Biblioteka (.bib)", icon: "quote", keys: "mod+shift+b", group: "Okno", run: () => (project && tab === "projekt" ? openLibrary("bib") : false) },
    { id: "app.gallery", title: "Galeria obrazów", icon: "image", keys: "mod+shift+g", group: "Okno", run: () => (project && tab === "projekt" ? openLibrary("images") : false) },
    { id: "app.notePad", title: "Notatnik pływający", icon: "note", keys: "mod+shift+m", group: "Notatki", run: () => void togglePad() },
    {
      id: "app.noteAppend",
      title: "Dopisz zaznaczenie do notatki",
      icon: "note",
      keys: "mod+shift+n",
      when: "editorFocus",
      group: "Notatki",
      run: () => {
        const s = editor()?.selection();
        if (!s) return false;
        void sendToNote(s.text, s.source);
      },
    },
    {
      id: "app.saveTemplate",
      title: "Zapisz projekt jako szablon…",
      icon: "report",
      group: "Projekt",
      run: () => {
        const p = currentProject();
        if (!p) return false;
        void (async () => {
          await editor()?.saveAll();
          const name = await promptText("Nazwa szablonu", { value: p.name, confirmText: "Zapisz" });
          if (!name?.trim()) return;
          try {
            await call("template_save", { pid: p.id, name: name.trim() });
            toast(`Zapisano szablon „${name.trim()}”`, { icon: "check" });
          } catch (e) {
            void showError("Nie udało się zapisać szablonu", e);
          }
        })();
      },
    },
    { id: "app.quickOpen", title: "Szybkie otwieranie pliku", icon: "search", keys: "mod+p", group: "Okno", run: () => (project ? openPalette("") : false) },
    { id: "app.shortcuts", title: "Skróty klawiszowe", icon: "help", keys: "?", group: "Okno", run: () => openShortcuts() },
  ]);

  function onKey(e: KeyboardEvent): void {
    if (boot !== "ready") return;
    dispatchKey(e, isMac(), (c) => c.id.startsWith("app.") || (!!project && tab === "projekt"));
  }

  // Finder drop: on a folder in the tree → copy there; on the start screen → new project.
  function osDrop(paths: string[], x: number, y: number): void {
    if (boot !== "ready") return;
    if (tab === "tablica") {
      if (!dropOnBoard(paths)) toast("Na Tablicę można upuścić obrazy", { icon: "image" });
      return;
    }
    const t = osDropTarget(x, y);
    if (t === "@new-project") void dropFolders(paths);
    else if (t === "@editor") {
      const r = window.devicePixelRatio || 1;
      void dropFiles(paths, { x: x / r, y: y / r });
    }
    else if (t && activeTree()) void activeTree()?.copyIn(paths, t);
    else if (project && tab === "projekt") toast("Upuść na folder w drzewie plików", { icon: "folder" });
  }

  onMount(() => {
    void start();
    // Editor saves first (it may still write positions into the project state).
    const flushAll = () => leaveProject().then(() => Promise.all([flushAppSettings(), flushProject()])).then(() => {});
    const unsubs = [
      watchEngine(),
      onCloseRequested(flushAll),
      onOsDrag({ over: osDragOver, leave: osDragLeave, drop: osDrop }),
      onProjectMenu((a) => {
        if (boot !== "ready") return;
        if (a === "new") openWizard();
        else if (a === "folder") void folderFlow();
        else void closeProject().then(() => goTo("projekt"));
      }),
    ];
    const onUnload = () => void flushAll();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      for (const u of unsubs) void u.then((f) => f());
    };
  });
</script>

<svelte:window onkeydowncapture={onKey} />

{#if boot === "booting"}
  <div class="boot">
    <img class="boot-logo" src="/logo.png" alt="" width="96" height="96" />
  </div>
{:else if boot === "error"}
  <div class="error">
    <span class="error-icon"><Icon name="alert" size={40} /></span>
    <span class="error-title">Nie udało się uruchomić</span>
    <span class="error-body">{errorMsg}</span>
    <button class="btn primary" onclick={() => location.reload()}><Icon name="refresh" /></button>
  </div>
{:else}
  <div class="layout">
    <nav class="tabbar">
      <ProjectChip />
      {#each TABS as t (t.key)}
        <button
          class="tab"
          class:active={tab === t.key}
          onclick={() => goTo(t.key)}
          use:tip={{ label: t.label, keys: keysOf(`app.tab.${t.key}`) }}
        >
          <Icon name={t.icon} size={14} />
          <span>{t.label}</span>
        </button>
      {/each}
      <span class="spacer"></span>
      {#if project && tab === "projekt"}
        <div class="cols">
          {#each COLS as c (c.col)}
            <button class="icon-btn" class:on={!isHidden(c.col)} use:tip={{ label: c.label, keys: keysOf(`app.col.${c.col}`) }} onclick={() => toggleCol(c.col)}>
              <Icon name={c.icon} size={16} />
            </button>
          {/each}
        </div>
      {/if}
      <EngineChip onopen={() => goTo("ustawienia", "info")} />
      <button class="icon-btn help" use:tip={{ label: "Skróty klawiszowe", keys: keysOf("app.shortcuts") }} onclick={() => openShortcuts()}>
        <Icon name="help" size={16} />
      </button>
    </nav>
    <LoadingBar />
    <main class="content">
      {#each TABS as t (t.key)}
        {#if visited.has(t.key)}
          {@const C = t.component}
          <section class="pane" class:hidden={tab !== t.key}>
            <svelte:boundary>
              {#if C}
                <C />
              {:else}
                <Placeholder icon={t.icon} title={t.label} stage={t.stage ?? ""} />
              {/if}
              {#snippet failed(error, reset)}
                <div class="tab-failed">
                  <span class="error-title">Błąd w zakładce „{t.label}”</span>
                  <span class="error-body">{(error as Error)?.message ?? String(error)}</span>
                  <button class="btn primary" onclick={reset}><Icon name="refresh" /></button>
                </div>
              {/snippet}
            </svelte:boundary>
          </section>
        {/if}
      {/each}
    </main>
  </div>
{/if}

<NewProject />
<Palette />
<ImageDialog />
<ShortcutsModal />
<LibraryModal />
<FloatingNotePad />
<ContextMenuHost />
<DragGhost />
<TooltipHost />
<Toasts />
<DialogHost />

<style>
  /* ── Boot: settings load in milliseconds, so only the glowing logo, faded in late
     enough that a fast start never flashes it. ── */
  .boot {
    position: fixed;
    inset: 0;
    background: var(--bg-boot);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .boot-logo {
    display: block;
    opacity: 0;
    animation:
      appear 0.3s ease 0.25s forwards,
      glow 2.2s ease-in-out infinite;
  }
  @keyframes appear {
    to {
      opacity: 1;
    }
  }
  @keyframes glow {
    0%,
    100% {
      filter: drop-shadow(0 0 10px var(--accent-a40));
    }
    50% {
      filter: drop-shadow(0 0 24px var(--accent-a90));
    }
  }

  /* ── Error ── */
  .error,
  .tab-failed {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
  }
  .error {
    height: 100vh;
  }
  .error-icon,
  .error-title {
    color: var(--danger);
  }
  .error-title {
    font-size: 1.2rem;
    font-weight: 600;
  }
  .error-body {
    font-size: 0.85rem;
    color: var(--text-dim-2);
    max-width: 480px;
    -webkit-user-select: text;
    user-select: text;
  }

  /* ── Layout (praSzczur tab bar) ── */
  .layout {
    height: 100vh;
    display: flex;
    flex-direction: column;
    animation: fadein 0.35s ease;
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }
  .tabbar {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 10px 16px 0;
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 16px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    background: var(--shade);
    border: 1px solid var(--line-1);
    border-bottom: none;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    color: var(--text-dim-3);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .tab:hover:not(.active) {
    background: var(--hover);
    color: var(--text-dim-1);
  }
  .tab.active {
    background: var(--bg-panel);
    color: var(--accent);
    border-color: var(--line-2);
    box-shadow: 0 -2px 8px var(--accent-a10);
  }
  .help {
    margin-bottom: 3px;
  }
  .cols {
    display: flex;
    gap: 2px;
    margin: 0 8px 3px 0;
  }
  .content {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--bg-panel);
    border-top: 1px solid var(--line-2);
  }
  .pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .hidden {
    display: none !important;
  }
</style>
