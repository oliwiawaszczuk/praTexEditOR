// Formula under the cursor → floating KaTeX preview (docs/02-plan.md "Później").
// `mathAt` finds `$…$`, `$$…$$`, `\(…\)`, `\[…\]` and math environments around a position
// (scanning ±60 lines, comments masked) — also used by the symbol palette to know
// whether to wrap a symbol in `$…$`. KaTeX is loaded on first use (own chunk).

import { StateField, type EditorState } from "@codemirror/state";
import { showTooltip, type Tooltip, type TooltipView } from "@codemirror/view";
import { getSetting } from "#lib/core/appSettings.svelte.ts";

export interface MathHit {
  from: number;
  to: number;
  /** Source ready for KaTeX (delimiters stripped, `align` → `aligned`). */
  tex: string;
  display: boolean;
}

const WINDOW = 60;
const MATH_ENV = "equation|equation\\*|displaymath|math|align|align\\*|alignat\\*?|flalign\\*?|gather|gather\\*|multline|multline\\*|eqnarray|eqnarray\\*";
const REGION = new RegExp(
  `\\\\begin\\{(${MATH_ENV})\\}([\\s\\S]*?)\\\\end\\{\\1\\}|\\$\\$([\\s\\S]*?)\\$\\$|\\\\\\[([\\s\\S]*?)\\\\\\]|\\\\\\(([\\s\\S]*?)\\\\\\)|(?<![\\\\$])\\$((?:[^$\\\\\\n]|\\\\.)+)\\$`,
  "g",
);

/** Same text with `%` comments blanked out (length kept, so offsets stay valid). */
function mask(text: string): string {
  return text.replace(/(^|[^\\])%[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

function toKatex(env: string | undefined, body: string): { tex: string; display: boolean } {
  const clean = body.replace(/\\(?:label|tag)\{[^}]*\}/g, "").replace(/\\(?:nonumber|notag)\b/g, "").trim();
  if (!env) return { tex: clean, display: false };
  const e = env.replace("*", "");
  if (e === "align" || e === "flalign" || e === "alignat" || e === "eqnarray") return { tex: `\\begin{aligned}${clean}\\end{aligned}`, display: true };
  if (e === "gather" || e === "multline") return { tex: `\\begin{gathered}${clean}\\end{gathered}`, display: true };
  return { tex: clean, display: e !== "math" };
}

export function mathAt(state: EditorState, pos: number): MathHit | null {
  const doc = state.doc;
  const line = doc.lineAt(pos).number;
  const from = doc.line(Math.max(1, line - WINDOW)).from;
  const to = doc.line(Math.min(doc.lines, line + WINDOW)).to;
  const text = mask(doc.sliceString(from, to));
  REGION.lastIndex = 0;
  for (let m = REGION.exec(text); m; m = REGION.exec(text)) {
    const start = from + m.index;
    const end = start + m[0].length;
    if (start > pos) break;
    if (pos < start || pos > end) continue;
    if (m[1]) return { from: start, to: end, ...toKatex(m[1], m[2]) };
    const body = m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
    return { from: start, to: end, tex: body.trim(), display: m[3] !== undefined || m[4] !== undefined };
  }
  return null;
}

const enabled = () => getSetting("editor.formulaPreview", true);

const field = StateField.define<MathHit | null>({
  create: () => null,
  update(prev, tr) {
    if (!tr.docChanged && !tr.selection) return prev;
    if (!enabled()) return null;
    const sel = tr.state.selection.main;
    if (!sel.empty) return null;
    const hit = mathAt(tr.state, sel.head);
    if (!hit || !hit.tex) return null;
    return prev && prev.from === hit.from && prev.to === hit.to && prev.tex === hit.tex ? prev : hit;
  },
  provide: (f) =>
    showTooltip.compute([f], (state): Tooltip | null => {
      const hit = state.field(f);
      return hit ? { pos: hit.from, above: true, strictSide: false, arrow: false, create } : null;
    }),
});

type Katex = typeof import("katex").default;
let katex: Promise<Katex> | null = null;
const load = (): Promise<Katex> => (katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default));

// One shared `create`: CodeMirror then keeps the DOM while the formula is edited and only
// calls `update`, so the preview does not flicker on every keystroke.
function create(view: { state: EditorState }): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-formula-tip";
  let shown = "";
  const render = async (state: EditorState): Promise<void> => {
    const hit = state.field(field, false);
    if (!hit) return;
    const key = `${hit.display}|${hit.tex}`;
    if (key === shown) return;
    shown = key;
    const k = await load();
    if (shown !== key) return;
    dom.innerHTML = k.renderToString(hit.tex, { displayMode: hit.display, throwOnError: false, errorColor: "var(--text-dim-3)", output: "html", trust: false, strict: "ignore" });
  };
  void render(view.state);
  return { dom, update: (u) => void render(u.state) };
}

export const formulaPreview = field;
