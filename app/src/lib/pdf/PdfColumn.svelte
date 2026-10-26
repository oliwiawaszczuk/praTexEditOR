<script lang="ts">
  // Right column (docs/03-ux.md §3.3): status pill + PDF toolbar, the viewer (pdf.js
  // chunk, loaded lazily) and the error drawer. The PDF comes from the build cache over
  // pratex://; a failed build keeps the last PDF on screen with a red pill.
  import { onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import { keysOf, register, runCommand } from "#lib/core/commands.svelte.ts";
  import { formatKeys } from "#lib/core/keys.ts";
  import { currentProject, onLeaveProject, wsGet, wsSet } from "#lib/core/projects.svelte.ts";
  import { call, protoUrl } from "#lib/core/tauri.ts";
  import { getSetting } from "#lib/core/appSettings.svelte.ts";
  import { ENGINES, type Build, type EngineId } from "#lib/build/build.svelte.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
  import LogDrawer from "#lib/build/LogDrawer.svelte";
  import StatusPill from "#lib/build/StatusPill.svelte";
  import { openMenu, type MenuEntry } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { goTo } from "#lib/core/nav.svelte.ts";
  import { addImageToBoard } from "#lib/tabs/tablica/board.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import type { Anchor, Fit, SyncRect, Tone, ViewerState } from "./viewer.ts";

  let { build }: { build: Build } = $props();

  const pdfChunk = import("./PdfView.svelte");
  let view = $state<{
    zoomBy(f: number): void;
    setZoom(z: number): void;
    setFit(f: "width" | "page"): void;
    getAnchor(): Anchor | null;
    showRects(r: SyncRect[], o: { flash: boolean; always: boolean }): void;
    clip(page: number, x: number, y: number, w: number, h: number): Promise<Blob | null>;
  }>();
  let vs = $state<ViewerState>({ page: 0, pages: 0, zoom: wsGet("pdf.zoom", 1), fit: wsGet<Fit>("pdf.fit", "width") });
  let loadError = $state("");
  let clipping = $state(false);

  /** A rectangle selected in the PDF → PNG on the last opened board, captioned "plik.pdf s. N". */
  async function onClip(r: { page: number; x: number; y: number; w: number; h: number } | null): Promise<void> {
    clipping = false;
    if (!r || !view) return;
    try {
      const blob = await view.clip(r.page, r.x, r.y, r.w, r.h);
      if (!blob) return;
      const main = currentProject()?.main?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "dokument";
      const name = await addImageToBoard(blob, r.w, r.h, `${main}.pdf s. ${r.page + 1}`);
      toast(`Dodano do tablicy „${name}”`, { icon: "board", action: () => goTo("tablica") });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }
  function onEsc(e: KeyboardEvent): void {
    if (clipping && e.key === "Escape") clipping = false;
  }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drawer = $derived(wsGet("pdf.drawer", false));
  const rev = $derived(build.last?.rev ?? 0);
  const url = $derived(rev ? protoUrl(`pdf/${build.pid}`, { v: rev }) : null);
  // The column lives inside {#key project.id}: the project never changes under it.
  // svelte-ignore state_referenced_locally
  const pid = build.pid;

  // Zoom / fit / position per project.
  let posTimer: ReturnType<typeof setTimeout> | null = null;
  function onState(s: ViewerState): void {
    vs = s;
    if (s.fit !== wsGet("pdf.fit", "width")) wsSet("pdf.fit", s.fit);
    if (!s.fit && s.zoom !== wsGet("pdf.zoom", 1)) wsSet("pdf.zoom", Math.round(s.zoom * 1000) / 1000);
    if (posTimer) clearTimeout(posTimer);
    posTimer = setTimeout(savePos, 800);
  }
  function savePos(): void {
    posTimer = null;
    const a = view?.getAnchor();
    if (a) wsSet("pdf.anchor", { page: a.page, offset: Math.round(a.offset) });
  }
  const offLeave = onLeaveProject(async () => savePos());

  const zoomIn = () => (view ? void view.zoomBy(1.15) : false);
  const zoomOut = () => (view ? void view.zoomBy(1 / 1.15) : false);
  const offCmds = register([
    { id: "pdf.zoomIn", title: "Powiększ PDF", icon: "plus", keys: "mod+=", run: zoomIn },
    { id: "pdf.zoomOut", title: "Pomniejsz PDF", icon: "minus", keys: "mod+-", run: zoomOut },
    { id: "pdf.fitWidth", title: "Dopasuj szerokość", icon: "fitWidth", keys: "mod+0", run: () => (view ? void view.setFit("width") : false) },
    { id: "pdf.fitPage", title: "Cała strona", icon: "fitPage", run: () => (view ? void view.setFit("page") : false) },
    { id: "pdf.tone", title: "Ciemny PDF (włącz / wyłącz)", icon: "moon", run: () => void wsSet("pdf.tone", tone === "off" ? "night" : "off") },
    { id: "pdf.export", title: "Eksportuj PDF", icon: "download", run: () => void exportPdf(false) },
    {
      id: "pdf.clip",
      title: "Zrzut fragmentu PDF → Tablica",
      icon: "camera",
      run: () => {
        if (!rev) return false;
        showCol("right");
        clipping = !clipping;
        if (clipping) toast("Zaznacz fragment strony (Esc anuluje)", { icon: "camera", ms: 2200 });
      },
    },
    { id: "sync.toPdf", title: "Pokaż w PDF", icon: "target", keys: "mod+j", run: () => syncToPdf() },
    { id: "pdf.follow", title: "PDF podąża za kursorem", icon: "link", run: () => void wsSet("pdf.follow", !follow) },
  ]);

  // ── SyncTeX ────────────────────────────────────────────────────────────────

  /** Code → PDF for the editor cursor (⌘J, ⌘+click in the editor, ◎). */
  function syncToPdf(): boolean {
    const c = editor()?.cursor();
    if (!c || !rev) return false;
    showCol("right");
    void forward(c, true);
    return true;
  }

  async function forward(c: { path: string; line: number }, explicit: boolean): Promise<void> {
    try {
      const rects = await call<SyncRect[]>("synctex_forward", { pid, file: c.path, line: c.line });
      if (!rects.length) {
        if (explicit) toast("Tej linii nie ma w PDF", { icon: "target" });
        return;
      }
      view?.showRects(rects, { flash: explicit, always: false });
    } catch (e) {
      if (explicit) toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  /** PDF → code: a click on a page (setting: plain click or ⌘+click). */
  async function onPick(p: { page: number; x: number; y: number }, mod: boolean): Promise<void> {
    if (getSetting<"click" | "mod">("pdf.syncClick", "click") === "mod" && !mod) return;
    try {
      const hit = await call<{ file: string; line: number } | null>("synctex_inverse", { pid, page: p.page, x: p.x, y: p.y });
      if (!hit) return;
      showCol("mid");
      await editor()?.reveal(hit.file, hit.line);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  // Follow the cursor: at most one query per 150 ms, the last position always wins.
  const follow = $derived(wsGet("pdf.follow", false));
  const tone = $derived(wsGet<Tone>("pdf.tone", "off"));
  const TONES: { id: Tone; label: string; icon: "moon" | "pdf" }[] = [
    { id: "off", label: "Jasny papier", icon: "pdf" },
    { id: "night", label: "Papier nocny (obrazy bez zmian)", icon: "moon" },
    { id: "invert", label: "Odwróć kolory", icon: "moon" },
  ];
  function toneMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(
      { clientX: r.right - 240, clientY: r.bottom + 4 },
      TONES.map((t) => ({ icon: tone === t.id ? ("check" as const) : t.icon, label: t.label, run: () => wsSet("pdf.tone", t.id) })),
    );
  }
  let followTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: { path: string; line: number } | null = null;
  function onCursor(c: { path: string; line: number }): void {
    pending = c;
    if (followTimer) return;
    followTimer = setTimeout(() => {
      followTimer = null;
      if (pending && rev) void forward(pending, false);
      pending = null;
    }, 150);
  }
  $effect(() => {
    const ed = editor();
    if (!ed || !follow) return;
    return ed.onCursor(onCursor);
  });
  onDestroy(() => {
    offCmds();
    offLeave();
    if (posTimer) clearTimeout(posTimer);
    if (followTimer) clearTimeout(followTimer);
  });

  async function exportPdf(ask: boolean): Promise<void> {
    try {
      const to = await call<string | null>("pdf_export", { pid, ask });
      if (to) toast(`Zapisano ${to.split(/[\\/]/).pop()}`, { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  function exportMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      { icon: "download", label: "Obok pliku głównego", run: () => void exportPdf(false) },
      { icon: "disk", label: "Zapisz jako…", run: () => void exportPdf(true) },
    ]);
  }

  function moreMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const current = build.engineOverride;
    const engines: MenuEntry[] = [
      { icon: current === null ? "check" : "engine", label: `Silnik: domyślny`, run: () => build.setEngine(null) },
      ...ENGINES.map((x) => ({
        icon: current === x.id ? ("check" as const) : ("engine" as const),
        label: `Silnik: ${x.label}`,
        run: () => build.setEngine(x.id as EngineId),
      })),
    ];
    openMenu({ clientX: r.right - 220, clientY: r.bottom + 4 }, [
      { icon: "reveal", label: "Otwórz w Podglądzie", disabled: !rev, run: () => void call("pdf_open_external", { pid }).catch((err) => toast(String(err), { icon: "alert", error: true })) },
      { icon: "trash", label: "Wyczyść pliki kompilacji", disabled: build.busy, run: () => void clean() },
      "sep",
      ...engines,
    ]);
  }

  async function clean(): Promise<void> {
    try {
      await call("build_clean", { pid });
      toast("Wyczyszczono pliki kompilacji", { icon: "trash" });
      build.request();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  const pct = $derived(Math.round(vs.zoom * 100));
</script>

<svelte:window onkeydown={onEsc} />

<div class="col">
  <div class="bar">
    <StatusPill {build} {drawer} ontoggle={() => wsSet("pdf.drawer", !drawer)} />
    <span class="spacer"></span>
    <div class="grp">
      <button class="icon-btn" disabled={!rev} use:tip={{ label: "Pomniejsz", keys: keysOf("pdf.zoomOut") }} onclick={zoomOut}><Icon name="minus" size={14} /></button>
      <button class="zoom" disabled={!rev} use:tip={"100 %"} onclick={() => view?.setZoom(1)}>{pct} %</button>
      <button class="icon-btn" disabled={!rev} use:tip={{ label: "Powiększ", keys: keysOf("pdf.zoomIn") }} onclick={zoomIn}><Icon name="plus" size={14} /></button>
      <button class="icon-btn" class:on={vs.fit === "width"} disabled={!rev} use:tip={{ label: "Dopasuj szerokość", keys: keysOf("pdf.fitWidth") }} onclick={() => view?.setFit("width")}><Icon name="fitWidth" size={15} /></button>
      <button class="icon-btn" class:on={vs.fit === "page"} disabled={!rev} use:tip={"Cała strona"} onclick={() => view?.setFit("page")}><Icon name="fitPage" size={15} /></button>
    </div>
    <div class="grp">
      <button class="icon-btn" disabled={!rev} use:tip={{ label: "Pokaż kursor w PDF (też ⌘+klik w kodzie)", keys: keysOf("sync.toPdf") }} onclick={() => syncToPdf()}><Icon name="target" size={15} /></button>
      <button class="icon-btn" class:on={follow} disabled={!rev} use:tip={follow ? "PDF podąża za kursorem (klik: wyłącz)" : "PDF podąża za kursorem"} onclick={() => wsSet("pdf.follow", !follow)}><Icon name="link" size={15} /></button>
    </div>
    <div class="grp">
      <button class="icon-btn" class:on={tone !== "off"} use:tip={{ label: "Ciemny PDF", keys: keysOf("pdf.tone") }} onmousedown={(e) => e.preventDefault()} onclick={toneMenu} oncontextmenu={(e) => { e.preventDefault(); runCommand("pdf.tone"); }}><Icon name="moon" size={15} /></button>
      <button class="icon-btn" class:on={clipping} disabled={!rev} use:tip={{ label: "Zrzut fragmentu → Tablica", keys: keysOf("pdf.clip") }} onclick={() => runCommand("pdf.clip")}><Icon name="camera" size={15} /></button>
      <button class="icon-btn" disabled={!rev} use:tip={"Eksportuj PDF"} onclick={exportMenu}><Icon name="download" size={15} /></button>
      <button class="icon-btn" use:tip={"Więcej"} onclick={moreMenu}><Icon name="more" size={15} /></button>
    </div>
  </div>

  <div class="body">
    {#if url}
      {#await pdfChunk then m}
        <m.default
          bind:this={view}
          {url}
          fit={vs.fit}
          zoom={vs.zoom}
          anchor={wsGet<Anchor | null>("pdf.anchor", null)}
          onstate={onState}
          onerror={(msg) => (loadError = msg)}
          onloaded={() => (loadError = "")}
          onpick={(p, mod) => void onPick(p, mod)}
          {clipping}
          {tone}
          onclip={(r) => void onClip(r)}
          onlink={(u) => void call("open_url", { url: u }).catch((e) => toast(String(e instanceof Error ? e.message : e), { icon: "alert", error: true }))}
        />
      {/await}
      {#if loadError}
        <div class="load-error"><Icon name="alert" size={14} /> {loadError}</div>
      {/if}
    {:else if build.busy}
      <div class="skeleton" aria-hidden="true">
        <div class="sheet">
          <span class="l w60"></span><span class="l w90"></span><span class="l w80"></span><span class="l w90"></span><span class="l w40"></span>
          <span class="l w90 gap"></span><span class="l w70"></span><span class="l w85"></span>
        </div>
      </div>
    {:else if build.loaded}
      <div class="empty">
        <span class="big"><Icon name="pdf" size={60} /><span class="gear"><Icon name="gear" size={26} /></span></span>
        {#if build.last?.message}
          <span class="msg bad">{build.last.message}</span>
        {:else if build.counts.error}
          <span class="msg bad">PDF nie powstał — zobacz błędy</span>
        {/if}
        <button class="hint" onclick={() => void build.compileNow()}>
          <Icon name="play" size={12} />
          <kbd>{formatKeys(keysOf("build.compile") ?? "mod+s")}</kbd>
        </button>
      </div>
    {/if}
  </div>

  {#if drawer}
    <div class="drawer-slot" transition:slide={{ duration: reduceMotion ? 0 : 160 }}>
      <LogDrawer {build} onclose={() => wsSet("pdf.drawer", false)} />
    </div>
  {/if}
</div>

<style>
  .drawer-slot {
    flex-shrink: 0;
    height: min(40%, 300px);
    min-height: 120px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .col {
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
    height: 38px;
    padding: 0 8px;
    background: var(--bg-panel-2);
    border-bottom: 1px solid var(--line-1);
  }
  .spacer {
    flex: 1;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .grp + .grp {
    padding-left: 6px;
    border-left: 1px solid var(--line-1);
  }
  .zoom {
    min-width: 50px;
    padding: 2px 4px;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .zoom:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .zoom:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .icon-btn.on {
    color: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    background: var(--pdf-bg);
  }
  .load-error {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    color: var(--danger);
    background: var(--bg-panel);
    border: 1px solid var(--danger-a40);
    border-radius: var(--radius-sm);
  }

  /* First compile: a page skeleton with a moving shine instead of emptiness. */
  .skeleton {
    flex: 1;
    display: flex;
    justify-content: center;
    padding: 14px;
    overflow: hidden;
  }
  .sheet {
    width: min(100%, 520px);
    aspect-ratio: 1 / 1.414;
    padding: 9% 10%;
    display: flex;
    flex-direction: column;
    gap: 3.2%;
    background: var(--pdf-page);
    box-shadow: var(--pdf-page-shadow);
    opacity: 0.12;
    animation: fadein 0.35s ease;
  }
  .l {
    display: block;
    height: 2.2%;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--pdf-skeleton) 0%, var(--pdf-skeleton-shine) 50%, var(--pdf-skeleton) 100%) 0 0 / 200% 100%;
    animation: shine 1.3s linear infinite;
    filter: brightness(0.6);
  }
  .w40 { width: 40%; }
  .w60 { width: 60%; }
  .w70 { width: 70%; }
  .w80 { width: 80%; }
  .w85 { width: 85%; }
  .w90 { width: 90%; }
  .gap { margin-top: 6%; }
  @keyframes shine {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 24px;
    text-align: center;
    animation: fadein 0.35s ease;
  }
  .big {
    position: relative;
    display: flex;
    color: var(--text-dim-4);
  }
  .gear {
    position: absolute;
    right: -10px;
    bottom: -4px;
    display: flex;
    color: var(--text-dim-3);
    background: var(--pdf-bg);
    border-radius: 50%;
  }
  .msg {
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    max-width: 360px;
  }
  .msg.bad {
    color: var(--danger);
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    cursor: pointer;
  }
  .hint:hover {
    color: var(--accent);
    border-color: var(--accent-a30);
  }
  kbd {
    font-family: var(--font);
  }
</style>
