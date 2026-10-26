<script lang="ts">
  // The project view: [files] | [editor] | [PDF] (docs/03-ux.md §3).
  import { onDestroy } from "svelte";
  import { currentProject, type Project } from "#lib/core/projects.svelte.ts";
  import { ProjectIndex, setActiveIndex } from "#lib/index/index.svelte.ts";
  import { Build, setActiveBuild } from "#lib/build/build.svelte.ts";
  import { editor, setEditor } from "#lib/editor/bridge.svelte.ts";
  import PdfColumn from "#lib/pdf/PdfColumn.svelte";
  import { keysOf, register } from "#lib/core/commands.svelte.ts";
  import { keywordsOf } from "#lib/snippets/builtin.ts";
  import { ensurePackages } from "#lib/snippets/requires.ts";
  import { commandId, snippets } from "#lib/snippets/store.svelte.ts";
  import type { Docs } from "#lib/editor/docs.svelte.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import FileTree from "#lib/tree/FileTree.svelte";
  import Splitter from "./Splitter.svelte";
  import {
    DEFAULT_LEFT,
    defaultRight,
    hidden,
    leftWidth,
    MIN,
    rightWidth,
    setLeftWidth,
    setRightWidth,
    showCol,
    toggleCol,
    type Col,
  } from "./layout.svelte.ts";

  // Compilation of this project; registered before the editor chunk loads, so its
  // editor-focus keys (⌘Enter) are in the keymap of every editor state.
  const build = new Build(() => currentProject() as Project);
  setActiveBuild(build);
  void build.start();

  // Project index: outline, labels, bibliography (palette @ # &, completion, breadcrumbs).
  const index = new ProjectIndex(() => currentProject() as Project);
  setActiveIndex(index);
  index.start();
  let lastMain = currentProject()?.main;
  $effect(() => {
    const m = currentProject()?.main;
    if (m !== lastMain) {
      lastMain = m;
      void index.refresh();
    }
  });

  // Every snippet is a command: palette, shortcut, "Wstaw" bar. Re-registered when the
  // user changes snippets (Ustawienia › Snippety).
  $effect(() => {
    const list = snippets();
    return register(
      list.map((sn) => ({
        id: commandId(sn.id),
        title: `Wstaw: ${sn.title}`,
        icon: sn.icon,
        keys: sn.keys,
        when: "editorFocus" as const,
        group: "Wstaw",
        keywords: keywordsOf(sn),
        run: () => {
          showCol("mid");
          const done = editor()?.insertSnippet(sn.body) ?? false;
          if (done) void ensurePackages(sn.requires);
          return done;
        },
      })),
    );
  });

  // Diagnostics → editor marks (also when the editor arrives after the build).
  $effect(() => {
    editor()?.setDiagnostics(build.visible);
  });

  // The editor is its own chunk (CodeMirror); its store lives here, not in the pane, so
  // hiding the middle column keeps every open file (states, undo, unsaved text).
  let docs = $state.raw<Docs | null>(null);
  let disposed = false;
  const editorChunk = import("#lib/editor/index.ts");
  void editorChunk.then(async (m) => {
    if (disposed) return;
    const d = new m.Docs(() => currentProject() as Project);
    docs = d;
    setEditor(d);
    await d.start();
  });
  onDestroy(() => {
    disposed = true;
    setEditor(null);
    docs?.dispose();
    setActiveBuild(null);
    build.dispose();
    setActiveIndex(null);
    index.dispose();
  });

  // Live widths while dragging; persisted once at the end of the gesture.
  let dragLeft = $state<number | null>(null);
  let dragRight = $state<number | null>(null);
  let startLeft = 0;
  let startRight = 0;
  let wrap = $state<HTMLDivElement>();

  const h = $derived(hidden());
  const left = $derived(dragLeft ?? leftWidth());
  const right = $derived(dragRight ?? rightWidth());

  /** Keep the middle column at least MIN.mid wide. */
  function room(): number {
    return (wrap?.clientWidth ?? window.innerWidth) - MIN.mid;
  }

  function dragL(dx: number): void {
    if (dragLeft === null) startLeft = leftWidth();
    const otherW = h.right ? 0 : right;
    dragLeft = Math.min(Math.max(startLeft + dx, 60), room() - otherW);
  }
  function endL(): void {
    if (dragLeft === null) return;
    if (dragLeft < MIN.left - 50) toggleCol("left");
    else setLeftWidth(Math.max(MIN.left, dragLeft));
    dragLeft = null;
  }
  function dragR(dx: number): void {
    if (dragRight === null) startRight = rightWidth();
    const otherW = h.left ? 0 : left;
    dragRight = Math.min(Math.max(startRight - dx, 80), room() - otherW);
  }
  function endR(): void {
    if (dragRight === null) return;
    if (dragRight < MIN.right - 80) toggleCol("right");
    else setRightWidth(Math.max(MIN.right, dragRight));
    dragRight = null;
  }

  const RAIL: Record<Col, { icon: IconName; label: string; keys: string }> = {
    left: { icon: "folder", label: "Pokaż pliki", keys: "mod+alt+1" },
    mid: { icon: "edit", label: "Pokaż edytor", keys: "mod+alt+2" },
    right: { icon: "pdf", label: "Pokaż PDF", keys: "mod+alt+3" },
  };
</script>

{#snippet rail(c: Col)}
  <button class="rail" use:tip={{ label: RAIL[c].label, keys: keysOf(`app.col.${c}`) }} onclick={() => showCol(c)}>
    <Icon name={RAIL[c].icon} size={16} />
  </button>
{/snippet}

<div class="ws" bind:this={wrap}>
  {#if h.left}
    {@render rail("left")}
  {:else}
    <section class="col left" class:grow={h.mid && h.right} style:width={h.mid && h.right ? undefined : `${left}px`}>
      <FileTree />
    </section>
    <Splitter ondrag={dragL} onend={endL} onreset={() => setLeftWidth(DEFAULT_LEFT)} />
  {/if}

  {#if h.mid}
    {@render rail("mid")}
  {:else}
    <section class="col mid">
      {#await editorChunk then m}
        {#if docs}<m.EditorPane {docs} />{/if}
      {/await}
    </section>
  {/if}

  {#if h.right}
    {@render rail("right")}
  {:else}
    <Splitter ondrag={dragR} onend={endR} onreset={() => setRightWidth(defaultRight())} />
    <section class="col right" class:grow={h.mid} style:width={h.mid ? undefined : `${right}px`}>
      <PdfColumn {build} />
    </section>
  {/if}
</div>

<style>
  .ws {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-shrink: 0;
  }
  .left {
    background: var(--bg-panel-2);
  }
  .mid {
    flex: 1;
    flex-shrink: 1;
    background: var(--editor-bg);
  }
  .right {
    background: var(--pdf-bg);
  }
  .right.grow,
  .left.grow {
    flex: 1;
  }
  .rail {
    width: 30px;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding-top: 10px;
    background: var(--bg-panel-2);
    border: none;
    border-right: 1px solid var(--line-1);
    border-left: 1px solid var(--line-1);
    color: var(--text-dim-3);
    cursor: pointer;
  }
  .rail:hover {
    color: var(--accent);
    background: var(--hover);
  }
</style>
