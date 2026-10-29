<script lang="ts">
  // Middle column: tabs, conflict / deleted bars, one EditorView shared by all text tabs
  // (docs.svelte.ts swaps states), pictogram placeholders for everything else.
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onDestroy, onMount } from "svelte";
  import { getSetting } from "#lib/core/appSettings.svelte.ts";
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import { currentProject, type Project } from "#lib/core/projects.svelte.ts";
  import { call, protoUrl } from "#lib/core/tauri.ts";
  import { revealInOs, revealLabel } from "#lib/core/os.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { formatSize } from "#lib/ui/format.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { fileKind, KIND_ICON, kindColor } from "#lib/tree/kinds.ts";
  import type { Docs } from "./docs.svelte.ts";
  import Crumbs from "./Crumbs.svelte";
  import InsertBar from "./InsertBar.svelte";
  import SymbolPalette from "#lib/symbols/SymbolPalette.svelte";
  import TabBar from "./TabBar.svelte";
  import { dropTarget } from "#lib/tree/dnd.svelte.ts";

  let { docs }: { docs: Docs } = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  const d = $derived(docs.active);
  const project = $derived(currentProject() as Project);

  onMount(() => {
    view = new EditorView({ parent: host, state: EditorState.create() });
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    docs.attach(view);
    if (import.meta.env.DEV) (window as unknown as { __pratex: object }).__pratex = { ...((window as unknown as { __pratex?: object }).__pratex ?? {}), view, docs };
  });

  onDestroy(() => {
    docs.detach();
    view?.scrollDOM.removeEventListener("scroll", onScroll);
    view?.destroy();
    view = null;
  });

  function onScroll(): void {
    docs.noteScroll();
  }

  // Preferences changed in Ustawienia → reconfigure the visible file.
  let prefKey = "";
  $effect(() => {
    const k = ["editor.fontSize", "editor.wrap", "editor.lineNumbers", "editor.indent"].map((s) => String(getSetting(s, null))).join("|");
    if (prefKey && k !== prefKey) docs.applyPrefs();
    prefKey = k;
  });

  // Images and PDFs from the tree are previewed here (pratex:// → no IPC copy).
  const fileUrl = (path: string) => protoUrl(`file/${project.id}`, { p: path });
  let pdfChunk: Promise<typeof import("#lib/pdf/PdfView.svelte")> | null = null;
  const pdfView = () => (pdfChunk ??= import("#lib/pdf/PdfView.svelte"));

  let imgFailed = $state(new Set<string>());

  const PH: Record<string, { icon: IconName; title: string }> = {
    binary: { icon: "file", title: "Plik binarny" },
    tooBig: { icon: "alert", title: "Plik jest za duży dla edytora" },
    encoding: { icon: "alert", title: "Plik nie jest zapisany w UTF-8" },
    error: { icon: "alert", title: "Nie udało się otworzyć" },
    missing: { icon: "trash", title: "Pliku nie ma już na dysku" },
  };
</script>

<div class="pane">
  {#if docs.docs.length}
    <TabBar {docs} />
  {/if}

  {#if d?.kind === "text" && getSetting("editor.insertBar", true)}
    <InsertBar />
  {/if}
  <SymbolPalette />

  {#if d?.kind === "text"}
    <Crumbs {docs} />
  {/if}

  {#if d?.conflict}
    <div class="bar warn">
      <Icon name="alert" size={14} />
      <span class="msg">{d.comparing ? "Porównanie z wersją z dysku" : "Plik zmienił się na dysku"}</span>
      {#if d.comparing}
        <button class="btn primary" use:tip={"Zapisz wynik porównania"} onclick={() => void docs.keepMine(d)}><Icon name="check" size={13} /></button>
        <button class="icon-btn" use:tip={"Wróć"} onclick={() => void docs.cancelCompare(d)}><Icon name="close" size={14} /></button>
      {:else}
        <button class="icon-btn" use:tip={"Zostaw moją wersję"} onclick={() => void docs.keepMine(d)}><Icon name="disk" size={15} /></button>
        <button class="icon-btn" use:tip={"Weź wersję z dysku"} onclick={() => void docs.takeTheirs(d)}><Icon name="download" size={15} /></button>
        <button class="icon-btn" use:tip={"Porównaj"} onclick={() => void docs.compare(d)}><Icon name="compare" size={15} /></button>
      {/if}
    </div>
  {:else if d?.gone}
    <div class="bar danger">
      <Icon name="trash" size={14} />
      <span class="msg">Plik usunięto z dysku</span>
      <button class="icon-btn" use:tip={"Zapisz ponownie"} onclick={() => void docs.save(d, { force: true })}><Icon name="disk" size={15} /></button>
      <button class="icon-btn" use:tip={{ label: "Zamknij kartę", keys: keysOf("tab.close") }} onclick={() => void docs.close(d.path)}><Icon name="close" size={15} /></button>
    </div>
  {/if}

  <div class="body">
    <div class="host" class:hidden={d?.kind !== "text"} class:drop={dropTarget() === "@editor"} data-drop={d?.kind === "text" ? "@editor" : undefined} bind:this={host}></div>

    {#if !d}
      <div class="ph">
        <span class="big"><Icon name="tex" size={64} /></span>
        <span class="hint"><Icon name="folder" size={13} /> klik w drzewie = podgląd · dwuklik = karta</span>
      </div>
    {:else if d.kind === "loading"}
      <div class="ph"></div>
    {:else if d.kind === "binary" && fileKind(d.name) === "img" && !imgFailed.has(d.path)}
      <div class="preview img">
        <img src={fileUrl(d.path)} alt={d.name} onerror={() => (imgFailed = new Set(imgFailed).add(d.path))} />
      </div>
    {:else if d.kind === "binary" && fileKind(d.name) === "pdf"}
      <div class="preview">
        {#await pdfView() then m}
          {#key d.path}<m.default url={fileUrl(d.path)} fit="width" />{/key}
        {/await}
      </div>
    {:else if d.kind !== "text"}
      {@const k = fileKind(d.name)}
      {@const ph = d.kind === "binary" ? { icon: KIND_ICON[k], title: k === "img" ? "Obraz" : k === "pdf" ? "PDF" : PH.binary.title } : PH[d.kind] ?? PH.error}
      <div class="ph">
        <span class="big" style:color={d.kind === "binary" ? kindColor(k) : undefined}><Icon name={ph.icon} size={64} /></span>
        <span class="title">{d.name}</span>
        <span class="sub">{ph.title}{d.size ? ` · ${formatSize(d.size)}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
        {#if d.kind === "binary" && k === "img"}<span class="stage">tego formatu nie da się pokazać</span>{/if}
        {#if d.kind === "missing"}
          <button class="btn" onclick={() => void docs.close(d.path)}><Icon name="close" size={14} /></button>
        {:else}
          <button class="btn" use:tip={revealLabel()} onclick={() => revealInOs(project.id, d.path)}><Icon name="reveal" size={14} /></button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 8px 0 12px;
    font-size: var(--fs-md);
    border-bottom: 1px solid var(--line-1);
  }
  .bar.warn {
    color: var(--accent);
    background: var(--accent-a10);
  }
  .bar.danger {
    color: var(--danger);
    background: var(--danger-a15);
  }
  .msg {
    flex: 1;
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .host {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .host :global(.cm-editor) {
    flex: 1;
    min-width: 0;
  }
  .hidden {
    display: none;
  }
  .host.drop {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .ph {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    animation: fadein 0.35s ease;
  }
  .big {
    display: flex;
    color: var(--text-dim-4);
  }
  .title {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-dim-1);
  }
  .sub,
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
  .preview {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    background: var(--pdf-bg);
  }
  .preview.img {
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: auto;
    animation: fadein 0.35s ease;
  }
  .preview.img img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: repeating-conic-gradient(var(--line-2) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    box-shadow: var(--pdf-page-shadow);
  }
  .stage {
    padding: 2px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-a10);
    border: 1px solid var(--accent-a30);
    border-radius: 10px;
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }
</style>
