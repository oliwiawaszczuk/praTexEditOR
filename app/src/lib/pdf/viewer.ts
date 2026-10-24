// PDF viewer on pdf.js (docs/02-plan.md §5). Imperative on purpose: pages are plain DOM
// owned by this class, Svelte only hosts the scroll container.
//
// - Virtual: every page is a white box of known size; a canvas exists only for pages
//   in view ± 1 (others are released, ≤ MAX_CANVASES in memory). Text layer likewise.
// - No flicker on reload: the new document is opened and its visible pages are drawn
//   off-screen while the old one stays on screen; then everything is swapped in one
//   synchronous step (one paint). The position is kept as (page, offset in PDF points),
//   so a document that grew by a page does not jump.
// - Zoom: CSS sizes change at once (canvases stretch), a sharp render follows after
//   150 ms of quiet. No loops: work happens on scroll / resize / zoom events only.

import { GlobalWorkerOptions, getDocument, PDFWorker, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** CSS px per PDF point at 100 %. */
export const CSS_UNITS = 96 / 72;
const GAP = 14;
const PAD = 14;
const MAX_CANVASES = 8;
/** Canvas pixel budget per page (WebKit refuses very large canvases). */
const MAX_AREA = 16_000_000;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;

export type Fit = "width" | "page" | null;

export interface ViewerState {
  page: number;
  pages: number;
  /** 1 = 100 %. */
  zoom: number;
  fit: Fit;
}

interface Size {
  w: number;
  h: number;
}

interface PageView {
  div: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  /** Scale the canvas was drawn at (0 = never). */
  drawn: number;
  text: HTMLDivElement | null;
  textLayer: TextLayer | null;
}

/** A SyncTeX rectangle (Rust: synctex.rs): page index + PDF points, top-left origin. */
export interface SyncRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  page: number;
  /** Offset from the top of the page, in PDF points. */
  offset: number;
}

const ASSETS = "/pdfjs/";

// One worker thread for every document: a reload must not pay a worker start-up.
let sharedWorker: PDFWorker | null = null;

export interface OpenDoc {
  doc: PDFDocumentProxy;
  /** Destroying the task frees the document in the worker (the worker stays). */
  task: PDFDocumentLoadingTask;
}

export async function openPdf(data: ArrayBuffer): Promise<OpenDoc> {
  sharedWorker ??= new PDFWorker();
  const task = getDocument({
    data: new Uint8Array(data),
    worker: sharedWorker,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
  });
  return { doc: await task.promise, task };
}

export class PdfViewer {
  readonly scroller: HTMLElement;
  #content: HTMLDivElement;
  #doc: PDFDocumentProxy | null = null;
  #task: PDFDocumentLoadingTask | null = null;
  #pageProxies: PDFPageProxy[] = [];
  #sizes: Size[] = [];
  #tops: number[] = [];
  #views: PageView[] = [];
  #scale = CSS_UNITS;
  #zoom = 1;
  #fit: Fit = "width";
  #gen = 0;
  #rendering = false;
  #sharpTimer: ReturnType<typeof setTimeout> | null = null;
  #frame = 0;
  #resize: ResizeObserver;
  #lastWidth = 0;
  #lastHeight = 0;
  #disposed = false;
  #onState: (s: ViewerState) => void;
  #onScroll = () => this.#schedule();

  constructor(scroller: HTMLElement, opts: { fit?: Fit; zoom?: number; onState: (s: ViewerState) => void }) {
    this.scroller = scroller;
    this.#onState = opts.onState;
    this.#fit = opts.fit ?? "width";
    this.#zoom = opts.zoom ?? 1;
    this.#content = document.createElement("div");
    this.#content.className = "pdf-content";
    scroller.appendChild(this.#content);
    scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    // Deferred to the next frame: relayout inside the callback would resize the
    // scroller again (scrollbar) and trip the "ResizeObserver loop" guard.
    this.#resize = new ResizeObserver(() => requestAnimationFrame(() => this.#onResize()));
    this.#resize.observe(scroller);
  }

  #onResize(): void {
    if (this.#disposed) return;
    const scroller = this.scroller;
    {
      const w = scroller.clientWidth;
      const h = scroller.clientHeight;
      if (w === this.#lastWidth && h === this.#lastHeight) return;
      this.#lastWidth = w;
      this.#lastHeight = h;
      if (this.#doc && this.#fit) this.#rescale(this.#fitZoom(this.#fit), null);
      else this.#schedule();
    }
  }

  get pages(): number {
    return this.#sizes.length;
  }

  get hasDoc(): boolean {
    return this.#doc !== null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Show a new document. The old one stays on screen until the new one is ready. */
  async load(data: ArrayBuffer, keep: Anchor | null = this.anchor()): Promise<void> {
    const gen = ++this.#gen;
    const { doc, task } = await openPdf(data);
    if (gen !== this.#gen || this.#disposed) {
      void task.destroy();
      return;
    }
    const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
    const sizes = proxies.map((p) => {
      const v = p.getViewport({ scale: 1 });
      return { w: v.width, h: v.height };
    });
    if (gen !== this.#gen || this.#disposed) {
      void task.destroy();
      return;
    }

    const zoom = this.#fit ? this.#fitZoom(this.#fit, sizes) : this.#zoom;
    const scale = zoom * CSS_UNITS;
    const tops = layout(sizes, scale);
    const at = keep ? Math.min(keep.page, sizes.length - 1) : 0;
    const scrollTop = keep ? tops[at] + Math.min(keep.offset, sizes[at].h) * scale - PAD : 0;

    // Draw what will be visible, off-screen, before touching the DOM.
    const [first, last] = range(tops, sizes, scale, scrollTop, this.scroller.clientHeight);
    const ready = new Map<number, HTMLCanvasElement>();
    for (let i = first; i <= last; i++) {
      const c = await drawPage(proxies[i], scale);
      if (gen !== this.#gen || this.#disposed) {
        void task.destroy();
        return;
      }
      if (c) ready.set(i, c);
    }

    // Swap in one synchronous step.
    const old = this.#task;
    this.#doc = doc;
    this.#task = task;
    this.#pageProxies = proxies;
    this.#sizes = sizes;
    this.#zoom = zoom;
    this.#scale = scale;
    this.#tops = tops;
    this.#syncViews();
    for (const [i, c] of ready) this.#putCanvas(i, c, scale);
    this.#applyLayout();
    this.scroller.scrollTop = scrollTop;
    this.#emit();
    if (old) void old.destroy();
    this.#schedule();
  }

  /** Forget the document (e.g. the file disappeared). */
  clear(): void {
    this.#gen++;
    const old = this.#task;
    this.#doc = null;
    this.#task = null;
    this.#pageProxies = [];
    this.#sizes = [];
    this.#tops = [];
    this.#syncViews();
    this.#applyLayout();
    if (old) void old.destroy();
    this.#emit();
  }

  destroy(): void {
    this.#disposed = true;
    this.#gen++;
    this.#resize.disconnect();
    this.scroller.removeEventListener("scroll", this.#onScroll);
    if (this.#sharpTimer) clearTimeout(this.#sharpTimer);
    cancelAnimationFrame(this.#frame);
    void this.#task?.destroy();
    this.#doc = null;
    this.#task = null;
    this.#content.remove();
  }

  // ── Position ───────────────────────────────────────────────────────────────

  anchor(): Anchor | null {
    if (!this.#sizes.length) return null;
    const y = this.scroller.scrollTop + PAD;
    const i = pageAt(this.#tops, y);
    return { page: i, offset: Math.max(0, (y - this.#tops[i]) / this.#scale) };
  }

  /** Page in the middle of the view (0-based). */
  currentPage(): number {
    if (!this.#sizes.length) return 0;
    return pageAt(this.#tops, this.scroller.scrollTop + this.scroller.clientHeight / 2);
  }

  goTo(page: number): void {
    if (!this.#sizes.length) return;
    const i = Math.min(Math.max(0, page), this.#sizes.length - 1);
    this.scroller.scrollTop = this.#tops[i] - PAD;
  }

  // ── SyncTeX ────────────────────────────────────────────────────────────────

  /** Client coordinates → page + PDF points (top-left origin), or null off the pages. */
  pointAt(clientX: number, clientY: number): { page: number; x: number; y: number } | null {
    for (let i = 0; i < this.#views.length; i++) {
      const r = this.#views[i].div.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return { page: i, x: (clientX - r.left) / this.#scale, y: (clientY - r.top) / this.#scale };
      }
    }
    return null;
  }

  /** Page `i` and the PDF-point position of a client point, clamped to that page. */
  pointOnPage(i: number, clientX: number, clientY: number): { x: number; y: number } | null {
    const v = this.#views[i];
    const size = this.#sizes[i];
    if (!v || !size) return null;
    const r = v.div.getBoundingClientRect();
    const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
    return { x: clamp((clientX - r.left) / this.#scale, size.w), y: clamp((clientY - r.top) / this.#scale, size.h) };
  }

  /** A rectangle of page `i` (PDF points, top-left origin) as a PNG, `density` px per point. */
  async clip(i: number, x: number, y: number, w: number, h: number, density = 3): Promise<Blob | null> {
    const page = this.#pageProxies[i];
    if (!page || w < 1 || h < 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * density));
    canvas.height = Math.max(1, Math.round(h * density));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: page.getViewport({ scale: density }),
      transform: [1, 0, 0, 1, -x * density, -y * density],
      background: "#ffffff",
    }).promise;
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
  }

  /** Bring rectangles (PDF points) into view; `flash` draws the pulsing frame. Scrolls
   * only when the first one is outside the middle of the view (`always`: put it at 1/3). */
  showRects(rects: SyncRect[], opts: { flash: boolean; always: boolean }): void {
    if (!rects.length || !this.#sizes.length) return;
    const first = rects[0];
    if (first.page >= this.#sizes.length) return;
    const s = this.#scale;
    const top = this.#tops[first.page] + first.y * s;
    const bottom = top + Math.max(first.h * s, 12);
    const view = this.scroller;
    const margin = view.clientHeight * 0.2;
    if (opts.always || top < view.scrollTop + margin || bottom > view.scrollTop + view.clientHeight - margin) {
      view.scrollTop = top - view.clientHeight / 3;
    }
    const left = parseFloat(this.#views[first.page].div.style.left) + first.x * s;
    if (left < view.scrollLeft || left + first.w * s > view.scrollLeft + view.clientWidth) view.scrollLeft = left - 20;
    if (!opts.flash) return;
    for (const r of rects.filter((x) => x.page === first.page).slice(0, 12)) {
      const page = this.#sizes[r.page];
      const box = document.createElement("div");
      box.className = "pdf-sync";
      const pad = 2;
      box.style.left = `${((r.x - pad) / page.w) * 100}%`;
      box.style.top = `${((r.y - pad) / page.h) * 100}%`;
      box.style.width = `${((r.w + 2 * pad) / page.w) * 100}%`;
      box.style.height = `${((r.h + 2 * pad) / page.h) * 100}%`;
      this.#views[r.page].div.appendChild(box);
      setTimeout(() => box.remove(), 1300);
    }
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  get zoom(): number {
    return this.#zoom;
  }

  get fit(): Fit {
    return this.#fit;
  }

  setFit(fit: Exclude<Fit, null>): void {
    this.#fit = fit;
    if (this.#doc) this.#rescale(this.#fitZoom(fit), null);
    else this.#emit();
  }

  /** Explicit zoom (1 = 100 %), keeping the point under `focus` (client coords) in place. */
  setZoom(zoom: number, focus: { x: number; y: number } | null = null): void {
    this.#fit = null;
    this.#rescale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)), focus);
  }

  zoomBy(factor: number, focus: { x: number; y: number } | null = null): void {
    this.setZoom(this.#zoom * factor, focus);
  }

  #fitZoom(fit: Exclude<Fit, null>, sizes: Size[] = this.#sizes): number {
    if (!sizes.length) return this.#zoom;
    const maxW = Math.max(...sizes.map((s) => s.w));
    const maxH = Math.max(...sizes.map((s) => s.h));
    const w = (this.scroller.clientWidth - 2 * PAD) / (maxW * CSS_UNITS);
    if (fit === "width") return Math.max(ZOOM_MIN, w);
    const h = (this.scroller.clientHeight - 2 * PAD) / (maxH * CSS_UNITS);
    return Math.max(ZOOM_MIN, Math.min(w, h));
  }

  #rescale(zoom: number, focus: { x: number; y: number } | null): void {
    if (!this.#sizes.length) {
      this.#zoom = zoom;
      this.#emit();
      return;
    }
    const rect = this.scroller.getBoundingClientRect();
    const fx = focus ? focus.x - rect.left : this.scroller.clientWidth / 2;
    const fy = focus ? focus.y - rect.top : 0;
    // Point under the focus, in page coordinates.
    const y = this.scroller.scrollTop + fy;
    const i = pageAt(this.#tops, y);
    const offY = (y - this.#tops[i]) / this.#scale;
    const pageLeft = this.#views[i] ? parseFloat(this.#views[i].div.style.left) : 0;
    const offX = (this.scroller.scrollLeft + fx - pageLeft) / this.#scale;

    this.#zoom = zoom;
    this.#scale = zoom * CSS_UNITS;
    this.#tops = layout(this.#sizes, this.#scale);
    this.#applyLayout();
    this.scroller.scrollTop = this.#tops[i] + offY * this.#scale - fy;
    const newLeft = this.#views[i] ? parseFloat(this.#views[i].div.style.left) : 0;
    this.scroller.scrollLeft = newLeft + offX * this.#scale - fx;
    this.#emit();
    // Sharp render once the gesture settles.
    if (this.#sharpTimer) clearTimeout(this.#sharpTimer);
    this.#sharpTimer = setTimeout(() => {
      this.#sharpTimer = null;
      this.#schedule();
    }, 150);
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  /** One page box per page; extra boxes removed. */
  #syncViews(): void {
    while (this.#views.length > this.#sizes.length) {
      const v = this.#views.pop() as PageView;
      this.#releaseText(v);
      v.div.remove();
    }
    for (const v of this.#views) {
      this.#releaseCanvas(v);
      this.#releaseText(v);
    }
    while (this.#views.length < this.#sizes.length) {
      const div = document.createElement("div");
      div.className = "pdf-page";
      div.dataset.page = String(this.#views.length + 1);
      this.#content.appendChild(div);
      this.#views.push({ div, canvas: null, drawn: 0, text: null, textLayer: null });
    }
  }

  #applyLayout(): void {
    const s = this.#scale;
    const n = this.#sizes.length;
    const maxW = n ? Math.max(...this.#sizes.map((z) => z.w)) * s : 0;
    const width = Math.max(this.scroller.clientWidth, maxW + 2 * PAD);
    const height = n ? this.#tops[n - 1] + this.#sizes[n - 1].h * s + PAD : 0;
    this.#content.style.width = `${width}px`;
    this.#content.style.height = `${height}px`;
    for (let i = 0; i < n; i++) {
      const v = this.#views[i];
      const w = this.#sizes[i].w * s;
      const st = v.div.style;
      st.width = `${w}px`;
      st.height = `${this.#sizes[i].h * s}px`;
      st.top = `${this.#tops[i]}px`;
      st.left = `${Math.max(PAD, (width - w) / 2)}px`;
      st.setProperty("--total-scale-factor", String(s));
    }
  }

  #putCanvas(i: number, c: HTMLCanvasElement, scale: number): void {
    const v = this.#views[i];
    if (!v) return;
    if (v.canvas) v.canvas.replaceWith(c);
    else v.div.prepend(c);
    if (v.canvas) shrink(v.canvas);
    v.canvas = c;
    v.drawn = scale;
  }

  #releaseCanvas(v: PageView): void {
    if (!v.canvas) return;
    v.canvas.remove();
    shrink(v.canvas);
    v.canvas = null;
    v.drawn = 0;
  }

  #releaseText(v: PageView): void {
    v.textLayer?.cancel();
    v.textLayer = null;
    v.text?.remove();
    v.text = null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  #schedule(): void {
    if (this.#frame || this.#disposed) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#emit();
      void this.#pump();
    });
  }

  /** Render the most wanted page, one at a time, until the view is sharp. */
  async #pump(): Promise<void> {
    if (this.#rendering || !this.#doc) return;
    this.#rendering = true;
    try {
      for (;;) {
        const gen = this.#gen;
        const [first, last] = range(this.#tops, this.#sizes, this.#scale, this.scroller.scrollTop, this.scroller.clientHeight);
        const lo = Math.max(0, first - 1);
        const hi = Math.min(this.#sizes.length - 1, last + 1);
        // Free canvases far from the view.
        let alive = this.#views.filter((v) => v.canvas).length;
        for (let i = 0; i < this.#views.length && alive > MAX_CANVASES; i++) {
          if (i < lo - 1 || i > hi + 1) {
            if (this.#views[i].canvas) alive--;
            this.#releaseCanvas(this.#views[i]);
            this.#releaseText(this.#views[i]);
          }
        }
        // Visible pages first (top to bottom), then the neighbours.
        const order = [...range2(first, last), lo, hi].filter((i, k, a) => i >= 0 && i < this.#sizes.length && a.indexOf(i) === k);
        const next = order.find((i) => this.#views[i].drawn !== this.#scale);
        if (next === undefined) {
          for (let i = first; i <= last; i++) this.#ensureText(i);
          return;
        }
        const scale = this.#scale;
        const c = await drawPage(this.#pageProxies[next], scale);
        if (gen !== this.#gen || !this.#doc) return;
        if (c && scale === this.#scale) {
          this.#putCanvas(next, c, scale);
          this.#releaseText(this.#views[next]); // rebuilt at the new scale below
        }
        else if (c) shrink(c);
        else this.#views[next].drawn = this.#scale; // failed page: do not retry forever
      }
    } finally {
      this.#rendering = false;
    }
  }

  #ensureText(i: number): void {
    const v = this.#views[i];
    if (!v || v.text || !this.#pageProxies[i]) return;
    const div = document.createElement("div");
    div.className = "textLayer";
    v.div.appendChild(div);
    v.text = div;
    const tl = new TextLayer({
      textContentSource: this.#pageProxies[i].streamTextContent(),
      container: div,
      viewport: this.#pageProxies[i].getViewport({ scale: this.#scale }),
    });
    v.textLayer = tl;
    tl.render().catch(() => {});
  }

  #emit(): void {
    this.#onState({ page: this.currentPage(), pages: this.#sizes.length, zoom: this.#zoom, fit: this.#fit });
  }
}

/** Top of every page box (px) at `scale`. */
function layout(sizes: Size[], scale: number): number[] {
  const tops: number[] = [];
  let y = PAD;
  for (const s of sizes) {
    tops.push(y);
    y += s.h * scale + GAP;
  }
  return tops;
}

/** Index of the page whose box contains `y` (or the last one above it). */
function pageAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** First and last page intersecting [top, top + height]. */
function range(tops: number[], sizes: Size[], scale: number, top: number, height: number): [number, number] {
  if (!tops.length) return [0, -1];
  const first = pageAt(tops, top);
  let last = first;
  while (last + 1 < tops.length && tops[last + 1] < top + height) last++;
  // pageAt picks the page above when `top` falls into a gap.
  const f = tops[first] + sizes[first].h * scale < top && first + 1 < tops.length ? first + 1 : first;
  return [Math.min(f, last), last];
}

function range2(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** Free a canvas's pixels now (WebKit keeps them until GC otherwise). */
function shrink(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

let paperColor = "";
/** Page background from the tokens (`--pdf-page`). */
function paper(): string {
  if (!paperColor) paperColor = getComputedStyle(document.documentElement).getPropertyValue("--pdf-page").trim() || "white";
  return paperColor;
}

async function drawPage(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement | null> {
  const viewport = page.getViewport({ scale });
  let out = window.devicePixelRatio || 1;
  const area = viewport.width * viewport.height * out * out;
  if (area > MAX_AREA) out *= Math.sqrt(MAX_AREA / area);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * out);
  canvas.height = Math.floor(viewport.height * out);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  let task: RenderTask | null = null;
  try {
    task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
      background: paper(),
    });
    await task.promise;
    return canvas;
  } catch {
    shrink(canvas);
    return null;
  }
}
