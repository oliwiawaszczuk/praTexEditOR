// Drag & drop with Pointer Events (HTML5 DnD is unreliable in the Tauri webview —
// praSzczur lesson). Drop targets are plain DOM attributes: `data-drop="<folder>"`
// (tree rows, the tree body) or `data-drop="@new-project"` (start screen). The same
// hit test serves in-app drags and files dragged in from Finder.

const THRESHOLD = 4;
const EXPAND_MS = 600;
const EDGE = 28;

export interface Ghost {
  x: number;
  y: number;
  label: string;
  count: number;
  copy: boolean;
}

let ghost = $state<Ghost | null>(null);
let target = $state<string | null>(null);
/** Finder drag currently over the window. */
let osActive = $state(false);

export const dragGhost = (): Ghost | null => ghost;
export const dropTarget = (): string | null => target;
export const osDragging = (): boolean => osActive;

function hit(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  return el?.dataset.drop ?? null;
}

let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverFor: string | null = null;

function setTarget(t: string | null, onHoverExpand?: (dir: string) => void): void {
  if (t === target) return;
  target = t;
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverFor = t;
  if (t && onHoverExpand && !t.startsWith("@")) {
    hoverTimer = setTimeout(() => {
      if (hoverFor === t) onHoverExpand(t);
    }, EXPAND_MS);
  }
}

export interface DragOptions {
  items: string[];
  label: string;
  /** Scroll container to auto-scroll near its edges. */
  scroller?: HTMLElement;
  onHoverExpand?: (dir: string) => void;
  /** `at`: window point of the drop (for "@editor": where to insert). */
  onDrop: (items: string[], target: string, copy: boolean, at: { x: number; y: number }) => void;
}

/** Call from pointerdown on a draggable row; the drag starts after a few pixels. */
export function pressDrag(e: PointerEvent, opts: DragOptions): void {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  let raf = 0;
  let lastY = sy;

  const scrollStep = () => {
    const sc = opts.scroller;
    if (!sc || !ghost) return;
    const r = sc.getBoundingClientRect();
    const dy = lastY < r.top + EDGE ? -8 : lastY > r.bottom - EDGE ? 8 : 0;
    if (dy) {
      sc.scrollTop += dy;
      raf = requestAnimationFrame(scrollStep);
    } else raf = 0;
  };

  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      started = true;
      document.body.classList.add("dragging");
    }
    lastY = ev.clientY;
    ghost = { x: ev.clientX, y: ev.clientY, label: opts.label, count: opts.items.length, copy: ev.altKey };
    const t = hit(ev.clientX, ev.clientY);
    setTarget(t && (!t.startsWith("@") || t === "@editor") ? t : null, opts.onHoverExpand);
    // Auto-scroll only while near an edge: one rAF loop, stopped as soon as we leave it.
    if (!raf) raf = requestAnimationFrame(scrollStep);
  };

  const end = (ev: PointerEvent | KeyboardEvent, cancelled: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    if (raf) cancelAnimationFrame(raf);
    document.body.classList.remove("dragging");
    const t = target;
    const copy = ev.altKey;
    ghost = null;
    setTarget(null);
    const at = "clientX" in ev ? { x: ev.clientX, y: ev.clientY } : { x: 0, y: 0 };
    if (started && !cancelled && t) opts.onDrop(opts.items, t, copy, at);
    if (started) {
      // Swallow the click that may follow the drop — only right now: when down and up
      // hit different elements no click comes, and a lingering listener would eat the
      // next real one.
      const swallow = (c: MouseEvent) => c.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
  };
  const up = (ev: PointerEvent) => end(ev, false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      end(ev, true);
    } else if (ev.key === "Alt" && ghost) ghost = { ...ghost, copy: true };
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

// ── Files from Finder (Tauri drag-drop events, physical pixels) ────────────────

export function osDragOver(px: number, py: number): void {
  osActive = true;
  const r = window.devicePixelRatio || 1;
  setTarget(hit(px / r, py / r));
}

export function osDragLeave(): void {
  osActive = false;
  setTarget(null);
}

/** Drop position → target attribute value (or null when not over a drop zone). */
export function osDropTarget(px: number, py: number): string | null {
  const r = window.devicePixelRatio || 1;
  const t = hit(px / r, py / r);
  osDragLeave();
  return t;
}
