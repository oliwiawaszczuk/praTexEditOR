// Compile diagnostics as editor marks (gutter + underline, message on hover), the
// short line flash after jumping to an error and the SyncTeX word mark. Rust gives file + line only; the mark
// spans the line's text, and CodeMirror maps it through later edits.

import { setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { locateInSource, type WordHint } from "#lib/core/syncword.ts";

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

// ── SyncTeX mark ─────────────────────────────────────────────────────────────

// Stays (static after one pulse) until the user moves the cursor, types or presses Esc:
// in a long paragraph a mark that fades on its own is gone before the eye finds it.
const syncEffect = StateEffect.define<{ line: number; from: number; to: number } | null>();

const syncLine = Decoration.line({ class: "cm-pratex-sync-line" });
const syncWord = Decoration.mark({ class: "cm-pratex-sync-word" });

const syncField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(syncEffect)) continue;
      const v = e.value;
      if (!v) return Decoration.none;
      return Decoration.set(v.to > v.from ? [syncLine.range(v.line), syncWord.range(v.from, v.to)] : [syncLine.range(v.line)]);
    }
    if (deco.size && (tr.docChanged || tr.selection)) return Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const syncMark = [
  syncField,
  EditorView.domEventHandlers({
    keydown(e, view) {
      if (e.key === "Escape" && view.state.field(syncField).size) view.dispatch({ effects: syncEffect.of(null) });
      return false;
    },
  }),
];

/** SyncTeX target: cursor on the word (`hint`) near line `n`, or the line's start; marked until the next action. */
export function revealSync(view: EditorView, n: number, hint: WordHint | null): void {
  const doc = view.state.doc;
  const center = Math.min(Math.max(1, n), doc.lines);
  const lines: { n: number; text: string }[] = [];
  for (let k = Math.max(1, center - 2); k <= Math.min(doc.lines, center + 2); k++) lines.push({ n: k, text: doc.line(k).text });
  const hit = hint ? locateInSource(lines, center, hint) : null;
  const line = doc.line(hit?.n ?? center);
  const lead = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const from = line.from + (hit?.from ?? lead);
  const to = hit ? line.from + hit.to : from;
  view.dispatch({
    selection: { anchor: from },
    effects: [EditorView.scrollIntoView(from, { y: "center" }), syncEffect.of({ line: line.from, from, to })],
  });
}
