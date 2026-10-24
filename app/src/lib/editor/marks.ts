// Compile diagnostics as editor marks (gutter + underline, message on hover) and the
// short line flash after jumping to an error. Rust gives file + line only; the mark
// spans the line's text, and CodeMirror maps it through later edits.

import { setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** Same shape as build.svelte.ts `Diagnostic` (kept local: no import from outside the chunk). */
export interface BuildDiagnostic {
  severity: "error" | "warning" | "box";
  file: string | null;
  line: number | null;
  message: string;
  hint: string | null;
}

const SEVERITY = { error: "error", warning: "warning", box: "info" } as const;

function render(d: BuildDiagnostic): () => Node {
  return () => {
    const box = document.createElement("div");
    box.className = "cm-pratex-diag";
    const m = document.createElement("div");
    m.textContent = d.message;
    box.appendChild(m);
    if (d.hint) {
      const h = document.createElement("div");
      h.className = "cm-pratex-hint";
      h.textContent = d.hint;
      box.appendChild(h);
    }
    return box;
  };
}

export function toCm(state: EditorState, list: BuildDiagnostic[]): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const d of list) {
    if (!d.line) continue;
    const line = state.doc.line(Math.min(Math.max(1, d.line), state.doc.lines));
    const lead = /^\s*/.exec(line.text)?.[0].length ?? 0;
    out.push({
      from: Math.min(line.from + lead, line.to),
      to: line.to,
      severity: SEVERITY[d.severity],
      message: d.hint ? `${d.message} — ${d.hint}` : d.message,
      renderMessage: render(d),
    });
  }
  return out;
}

export function diagnosticsSpec(state: EditorState, list: BuildDiagnostic[]): TransactionSpec {
  return setDiagnostics(state, toCm(state, list));
}

// ── Flash ────────────────────────────────────────────────────────────────────

const flashEffect = StateEffect.define<number | null>();

const flashLine = Decoration.line({ class: "cm-pratex-flash" });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(flashEffect)) return e.value === null ? Decoration.none : Decoration.set([flashLine.range(tr.state.doc.lineAt(e.value).from)]);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Select line `n`, scroll it to the middle and flash it for a moment. */
export function revealLine(view: EditorView, n: number): void {
  const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
  const lead = /^\s*/.exec(line.text)?.[0].length ?? 0;
  view.dispatch({
    selection: { anchor: line.from + lead },
    effects: [EditorView.scrollIntoView(line.from, { y: "center" }), flashEffect.of(line.from)],
  });
  setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flashEffect.of(null) });
  }, 1200);
}
