<script lang="ts">
  // Scroll container + PdfViewer (viewer.ts). Part of the pdf.js chunk: always loaded
  // with import(), never statically from the rest of the app.
  // `url` changes → fetch the bytes (pratex:// protocol, no IPC) → swap without flicker.
  import { onDestroy, onMount } from "svelte";
  import { PdfViewer, type Anchor, type Fit, type SyncRect, type ViewerState } from "./viewer.ts";

  let {
    url,
    fit = "width",
    zoom = 1,
    anchor = null,
    onstate,
    onerror,
    onloaded,
    onpick,
    clipping = false,
    onclip,
  }: {
    url: string | null;
    fit?: Fit;
    zoom?: number;
    /** Where to start on the first load (e.g. remembered across restarts). */
    anchor?: Anchor | null;
    onstate?: (s: ViewerState) => void;
    onerror?: (msg: string) => void;
    /** After a document is on screen; ms = fetch → visible. */
    onloaded?: (ms: number) => void;
    /** A click on a page (not a drag, not a text selection): page + PDF points, and
     * whether ⌘/Ctrl was held. */
    onpick?: (p: { page: number; x: number; y: number }, mod: boolean) => void;
    /** Rubber-band mode: a drag on a page selects a rectangle (PDF points) → onclip. */
    clipping?: boolean;
    onclip?: (r: { page: number; x: number; y: number; w: number; h: number } | null) => void;
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let viewer: PdfViewer | null = null;
  let pageLabel = $state("");
  let showLabel = $state(false);
  let labelTimer: ReturnType<typeof setTimeout> | null = null;
  let loaded = "";
  let first = true;

  onMount(() => {
    viewer = new PdfViewer(scroller as HTMLDivElement, {
      // svelte-ignore state_referenced_locally
      fit,
      // svelte-ignore state_referenced_locally
      zoom,
      onState: (s) => {
        const label = s.pages ? `${s.page + 1} / ${s.pages}` : "";
        if (label !== pageLabel && pageLabel) flashLabel();
        pageLabel = label;
        onstate?.(s);
      },
    });
    void sync();
  });

  onDestroy(() => {
    if (labelTimer) clearTimeout(labelTimer);
    viewer?.destroy();
    viewer = null;
  });

  $effect(() => {
    void url;
    void sync();
  });

  async function sync(): Promise<void> {
    const v = viewer;
    const want = url;
    if (!v || want === loaded) return;
    loaded = want ?? "";
    if (!want) {
      v.clear();
      return;
    }
    const t0 = performance.now();
    try {
      const res = await fetch(want, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const buf = await res.arrayBuffer();
      if (want !== loaded || viewer !== v) return;
      await v.load(buf, first ? anchor : v.anchor());
      first = false;
      onloaded?.(performance.now() - t0);
    } catch (e) {
      if (want === loaded) loaded = "";
      onerror?.(e instanceof Error ? e.message : String(e));
    }
  }

  function flashLabel(): void {
    showLabel = true;
    if (labelTimer) clearTimeout(labelTimer);
    labelTimer = setTimeout(() => (showLabel = false), 1000);
  }

  // ── Zoom gestures: ⌃/⌘ + wheel (trackpad pinch in Chromium-like webviews) and
  // Safari gesture events (WKWebView pinch). ──
  function onWheel(e: WheelEvent): void {
    if (!viewer || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    viewer.zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
  }

  let gestureStart = 1;
  function onGestureStart(e: Event): void {
    e.preventDefault();
    gestureStart = viewer?.zoom ?? 1;
  }
  function onGestureChange(e: Event): void {
    e.preventDefault();
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    viewer?.setZoom(gestureStart * g.scale, { x: g.clientX, y: g.clientY });
  }

  // ── Clip: drag a rectangle on one page (Esc / a tiny drag cancels) ──
  let band = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let bandFrom: { page: number; cx: number; cy: number } | null = null;

  function clipDown(e: PointerEvent): void {
    if (!clipping || e.button !== 0 || !viewer) return;
    const p = viewer.pointAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    bandFrom = { page: p.page, cx: e.clientX, cy: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function clipMove(e: PointerEvent): void {
    if (!bandFrom) return;
    band = {
      left: Math.min(bandFrom.cx, e.clientX),
      top: Math.min(bandFrom.cy, e.clientY),
      width: Math.abs(e.clientX - bandFrom.cx),
      height: Math.abs(e.clientY - bandFrom.cy),
    };
  }
  function clipUp(e: PointerEvent): void {
    const from = bandFrom;
    bandFrom = null;
    band = null;
    if (!from || !viewer) return;
    const a = viewer.pointOnPage(from.page, from.cx, from.cy);
    const b = viewer.pointOnPage(from.page, e.clientX, e.clientY);
    if (!a || !b || Math.abs(a.x - b.x) < 8 || Math.abs(a.y - b.y) < 8) return onclip?.(null);
    onclip?.({ page: from.page, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  }

  // Click on a page → onpick. A drag (text selection) is not a click.
  let down: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent): void {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }
  function onUp(e: PointerEvent): void {
    const d = down;
    down = null;
    if (!d || !viewer || !onpick || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    if ((window.getSelection()?.toString() ?? "").length > 0) return;
    const p = viewer.pointAt(e.clientX, e.clientY);
    if (p) onpick(p, e.metaKey || e.ctrlKey);
  }

  $effect(() => {
    const el = scroller;
    if (!el) return;
    el.addEventListener("pointerdown", clipDown, true);
    el.addEventListener("pointermove", clipMove);
    el.addEventListener("pointerup", clipUp);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("pointerdown", clipDown, true);
      el.removeEventListener("pointermove", clipMove);
      el.removeEventListener("pointerup", clipUp);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  });

  export function zoomBy(f: number): void {
    viewer?.zoomBy(f);
  }
  export function setZoom(z: number): void {
    viewer?.setZoom(z);
  }
  export function setFit(f: Exclude<Fit, null>): void {
    viewer?.setFit(f);
  }
  export function goTo(page: number): void {
    viewer?.goTo(page);
  }
  export function showRects(rects: SyncRect[], opts: { flash: boolean; always: boolean }): void {
    viewer?.showRects(rects, opts);
  }
  export function clip(page: number, x: number, y: number, w: number, h: number): Promise<Blob | null> {
    return viewer?.clip(page, x, y, w, h) ?? Promise.resolve(null);
  }
  export function getAnchor(): Anchor | null {
    return viewer?.anchor() ?? null;
  }
</script>

<div class="pdfv">
  <div class="scroller" class:clipping bind:this={scroller}></div>
  {#if band}<div class="band" style:left="{band.left}px" style:top="{band.top}px" style:width="{band.width}px" style:height="{band.height}px"></div>{/if}
  {#if pageLabel}
    <span class="page-label" class:show={showLabel}>{pageLabel}</span>
  {/if}
</div>

<style>
  .pdfv {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    display: flex;
  }
  .scroller.clipping {
    cursor: crosshair;
    user-select: none;
  }
  .band {
    position: fixed;
    z-index: 5;
    pointer-events: none;
    border: 1.5px solid var(--accent);
    background: var(--accent-a15);
  }
  .scroller {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--pdf-bg);
    overscroll-behavior: contain;
  }
  .scroller :global(.pdf-content) {
    position: relative;
  }
  .scroller :global(.pdf-page) {
    position: absolute;
    background: var(--pdf-page);
    box-shadow: var(--pdf-page-shadow);
    overflow: hidden;
    --scale-round-x: 1px;
    --scale-round-y: 1px;
  }
  .scroller :global(.pdf-page canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  /* SyncTeX: pulsing accent frame where the code lands (docs/03-ux.md §3.3). */
  .scroller :global(.pdf-sync) {
    position: absolute;
    z-index: 2;
    border: 2px solid var(--pdf-sync-flash);
    border-radius: 3px;
    background: var(--accent-a10);
    pointer-events: none;
    animation: sync-pulse 1.3s ease-out forwards;
  }
  @keyframes sync-pulse {
    0% {
      opacity: 0;
      transform: scale(1.08);
    }
    15% {
      opacity: 1;
      transform: scale(1);
    }
    45% {
      opacity: 0.55;
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .page-label {
    position: absolute;
    right: 18px;
    bottom: 14px;
    padding: 3px 10px;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    background: var(--backdrop);
    border-radius: 10px;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  .page-label.show {
    opacity: 1;
  }

  /* pdf.js text layer (from pdf_viewer.css, trimmed): transparent text over the
     canvas for selecting and copying. */
  .scroller :global(.textLayer) {
    position: absolute;
    text-align: initial;
    inset: 0;
    overflow: clip;
    opacity: 1;
    line-height: 1;
    letter-spacing: normal;
    word-spacing: normal;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: CanvasText;
    z-index: 0;
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }
  .scroller :global(.textLayer :is(span, br)) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    -webkit-user-select: text;
    user-select: text;
  }
  .scroller :global(.textLayer > :not(.markedContent)),
  .scroller :global(.textLayer .markedContent span:not(.markedContent)) {
    z-index: 1;
    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    --scale-x: 1;
    --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }
  .scroller :global(.textLayer .markedContent) {
    display: contents;
  }
  .scroller :global(.textLayer ::selection) {
    background: var(--accent-a40);
    color: transparent;
  }
  .scroller :global(.textLayer br::selection) {
    background: transparent;
  }
  .scroller :global(.textLayer .endOfContent) {
    display: block;
    position: absolute;
    inset: 100% 0 0;
    z-index: 0;
    cursor: default;
    -webkit-user-select: none;
    user-select: none;
  }
  .scroller :global(.textLayer.selecting .endOfContent) {
    top: 0;
  }
</style>
