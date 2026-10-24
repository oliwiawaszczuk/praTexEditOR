// LaTeX structure from plain lines: fold ranges (\begin…\end, sections) and the auto
// \end{…} on Enter. Pure line scanning — no syntax tree needed, and every scan is
// bounded, so a gutter full of foldable lines stays cheap on a 10 000-line file.

import { foldService, indentUnit } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Lines scanned at most when looking for the end of a block. */
const SCAN = 20000;

const LEVEL: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };

/** The line without its comment (an unescaped %). */
export function code(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "%") return line.slice(0, i);
  }
  return line;
}

export function sectionLevel(line: string): number | null {
  const m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/.exec(code(line));
  return m ? LEVEL[m[1]] : null;
}

// A fresh regex per scan: a shared /g one would have its lastIndex reset by the nested
// envBalance() call inside envEnd's loop.
const env = () => /\\(begin|end)\s*\{([^}]*)\}/g;

/** Net \begin{name} minus \end{name} on a line (from `from`). */
function envBalance(line: string, name: string, from = 0): number {
  let n = 0;
  const re = env();
  re.lastIndex = from;
  const c = code(line);
  for (let m; (m = re.exec(c)); ) if (m[2].trim() === name) n += m[1] === "begin" ? 1 : -1;
  return n;
}

/** Line number (1-based) of the \end matching the first unclosed \begin on line `n`. */
export function envEnd(line: (n: number) => string, count: number, n: number): number | null {
  const c = code(line(n));
  const re = env();
  for (let m; (m = re.exec(c)); ) {
    if (m[1] !== "begin") continue;
    const name = m[2].trim();
    let depth = envBalance(c, name, m.index);
    if (depth <= 0) continue; // closed on the same line
    for (let k = n + 1; k <= Math.min(count, n + SCAN); k++) {
      depth += envBalance(line(k), name);
      if (depth <= 0) return k;
    }
    return null;
  }
  return null;
}

/** Last line (1-based) of the section starting on line `n`. */
export function sectionEnd(line: (n: number) => string, count: number, n: number): number | null {
  const level = sectionLevel(line(n));
  if (level === null) return null;
  let end = count;
  for (let k = n + 1; k <= Math.min(count, n + SCAN); k++) {
    const t = line(k);
    const l = sectionLevel(t);
    if ((l !== null && l <= level) || /^\s*\\(end\s*\{document\}|appendix\b|printbibliography|bibliography\s*\{)/.test(code(t))) {
      end = k - 1;
      break;
    }
  }
  while (end > n && !line(end).trim()) end--;
  return end > n ? end : null;
}

export const latexFolding = foldService.of((state: EditorState, from: number) => {
  const doc = state.doc;
  const first = doc.lineAt(from);
  if (!first.text.includes("\\")) return null;
  const get = (k: number) => doc.line(k).text;
  const env = envEnd(get, doc.lines, first.number);
  if (env !== null) {
    // Keep the \end line visible: fold up to the end of the line before it.
    return env > first.number + 1 ? { from: first.to, to: doc.line(env - 1).to } : null;
  }
  const sec = sectionEnd(get, doc.lines, first.number);
  return sec !== null ? { from: first.to, to: doc.line(sec).to } : null;
});

const LISTS = new Set(["itemize", "enumerate", "description"]);

/** Enter right after `\begin{name}` (and its options) → body line + `\end{name}`, unless
 * the environment is already closed further down. */
export function endInsertion(state: EditorState): { from: number; insert: string; cursor: number } | null {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return null;
  const head = sel.main.head;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  if (line.text.slice(head - line.from).trim()) return null;
  const m = /\\begin\s*\{([^}]+)\}(\s*(\[[^\]]*\]|\{[^}]*\}))*\s*$/.exec(code(before));
  if (!m) return null;
  const name = m[1].trim();
  const get = (k: number) => state.doc.line(k).text;
  if (envEnd(get, state.doc.lines, line.number) !== null) return null;
  const indent = /^\s*/.exec(line.text)?.[0] ?? "";
  const body = indent + state.facet(indentUnit) + (LISTS.has(name) ? "\\item " : "");
  return { from: head, insert: `\n${body}\n${indent}\\end{${name}}`, cursor: head + 1 + body.length };
}

export function insertEnd(view: EditorView): boolean {
  const e = endInsertion(view.state);
  if (!e) return false;
  view.dispatch({
    changes: { from: e.from, insert: e.insert },
    selection: EditorSelection.cursor(e.cursor),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}
