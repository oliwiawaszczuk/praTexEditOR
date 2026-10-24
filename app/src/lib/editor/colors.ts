// Color swatches inside the code (docs/03-ux.md §5): next to `{HTML}{F4F5EF}`,
// `[HTML]{F4F5EF}`, `{RGB}{244,245,239}` and `{rgb}{0.96,0.96,0.94}` — as in
// `\definecolor{bg}{HTML}{F4F5EF}` or `\textcolor[HTML]{C0392B}{…}` — a small square in that
// color. A click opens the shared color popover; the value in the text follows the
// picker live (same model, same spelling style), and ⌘Z undoes it like any edit.

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { parseHex } from "#lib/ui/color.ts";
import { openColor } from "#lib/ui/colorPopup.svelte.ts";

type Model = "HTML" | "RGB" | "rgb";

/** `{HTML}{…}` / `[HTML]{…}`: the model and its value (group 3), inside the second braces. */
const COLOR = /([{[])(HTML|RGB|rgb)[}\]]\s*\{([^{}%\n]*)\}/g;

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** The color of a model value as "#rrggbb", or null when the text is not a valid one. */
export function toHex(model: Model, value: string): string | null {
  const v = value.trim();
  if (model === "HTML") return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
  const parts = v.split(",").map((x) => x.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d*\.?\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (model === "RGB") return n.every((x) => x <= 255 && Number.isInteger(x)) ? `#${n.map(hex2).join("")}` : null;
  return n.every((x) => x <= 1) ? `#${n.map((x) => hex2(x * 255)).join("")}` : null;
}

/** "#rrggbb" written the way the original was (case of HTML digits, ", " spacing). */
export function fromHex(model: Model, hex: string, like: string): string {
  const p = parseHex(hex) ?? "#000000";
  const rgb = [1, 3, 5].map((i) => parseInt(p.slice(i, i + 2), 16));
  const sep = /,\s/.test(like) ? ", " : ",";
  if (model === "HTML") return /[a-f]/.test(like) && !/[A-F]/.test(like) ? p.slice(1) : p.slice(1).toUpperCase();
  if (model === "RGB") return rgb.join(sep);
  return rgb.map((x) => String(Math.round((x / 255) * 1000) / 1000)).join(sep);
}

class Swatch extends WidgetType {
  constructor(
    readonly model: Model,
    readonly color: string,
  ) {
    super();
  }
  eq(o: Swatch): boolean {
    return o.model === this.model && o.color === this.color;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-color-swatch";
    el.style.setProperty("--c", this.color);
    el.setAttribute("data-color-trigger", "");
    el.title = "Wybierz kolor";
    // mousedown: keep the editor's selection and focus where they are
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pick(view, el, this.model);
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/** The value text from `from` up to the closing brace, as it stands in the document now. */
function valueRange(view: EditorView, from: number): { from: number; to: number } {
  const line = view.state.doc.lineAt(from);
  const end = line.text.indexOf("}", from - line.from);
  return { from, to: end < 0 ? from : line.from + end };
}

function pick(view: EditorView, el: HTMLElement, model: Model): void {
  const start = view.posAtDOM(el);
  let { from, to } = valueRange(view, start);
  const text = view.state.sliceDoc(from, to);
  const hex = toHex(model, text);
  if (!hex) return;
  openColor({
    anchor: el.getBoundingClientRect(),
    value: hex,
    label: "Kolor w kodzie",
    onclose: () => view.focus(),
    onchange: (next) => {
      const like = view.state.sliceDoc(from, to);
      const out = fromHex(model, next, like);
      if (out === like) return;
      view.dispatch({ changes: { from, to, insert: out }, userEvent: "input.color", selection: view.state.selection });
      to = from + out.length;
    },
  });
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      const cut = commentAt(line.text);
      const text = cut < 0 ? line.text : line.text.slice(0, cut);
      for (const m of text.matchAll(COLOR)) {
        const model = m[2] as Model;
        const color = toHex(model, m[3]);
        if (!color) continue;
        const at = line.from + (m.index ?? 0) + m[0].lastIndexOf("{") + 1;
        b.add(at, at, Decoration.widget({ widget: new Swatch(model, color), side: -1 }));
      }
    }
  }
  return b.finish();
}

/** Index of the first unescaped `%` (start of a comment), else -1. */
function commentAt(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "%") return i;
  }
  return -1;
}

export const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);
