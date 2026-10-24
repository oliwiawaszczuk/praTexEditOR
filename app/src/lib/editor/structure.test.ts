import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { code, endInsertion, envEnd, sectionEnd, sectionLevel } from "./structure.ts";

const doc = (s: string) => {
  const lines = s.split("\n");
  return [(n: number) => lines[n - 1], lines.length] as const;
};

describe("structure", () => {
  it("strips comments but not escaped percent", () => {
    expect(code("50\\% x % \\begin{a}")).toBe("50\\% x ");
  });

  it("finds the matching \\end with nesting and comments", () => {
    const [get, n] = doc("\\begin{itemize}\n  \\begin{itemize}\n  \\end{itemize}\n  % \\end{itemize}\n\\end{itemize}\n\\begin{a}\\end{a}");
    expect(envEnd(get, n, 1)).toBe(5);
    expect(envEnd(get, n, 2)).toBe(3);
    expect(envEnd(get, n, 6)).toBeNull();
  });

  it("section ends before the next one of the same or higher level", () => {
    const [get, n] = doc("\\section{A}\ntekst\n\\subsection{A1}\nx\n\n\\section{B}\ny\n\\end{document}");
    expect(sectionLevel("\\subsection*[k]{x}")).toBe(3);
    expect(sectionEnd(get, n, 1)).toBe(4);
    expect(sectionEnd(get, n, 3)).toBe(4);
    expect(sectionEnd(get, n, 6)).toBe(7);
  });

  it("Enter after \\begin inserts \\end once", () => {
    const run = (text: string) => {
      const state = EditorState.create({ doc: text, selection: { anchor: text.indexOf("|") } }).update({
        changes: { from: text.indexOf("|"), to: text.indexOf("|") + 1 },
      }).state;
      const e = endInsertion(state);
      if (!e) return null;
      const out = state.update({ changes: { from: e.from, insert: e.insert } }).state.doc.toString();
      return out.slice(0, e.cursor) + "|" + out.slice(e.cursor);
    };
    expect(run("  \\begin{figure}[h]|")).toBe("  \\begin{figure}[h]\n    |\n  \\end{figure}");
    expect(run("\\begin{itemize}|")).toBe("\\begin{itemize}\n  \\item |\n\\end{itemize}");
    expect(run("\\begin{itemize}|\n\\end{itemize}")).toBeNull();
    expect(run("\\begin{itemize} x|")).toBeNull();
  });
});
