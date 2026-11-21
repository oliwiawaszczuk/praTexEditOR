import { describe, expect, it } from "vitest";
import { toText } from "#lib/snippets/vscode.ts";
import { DEFAULT_OPTS, escapeLatex, parseCells, tableSnippet, type TableOpts } from "./table.ts";

const plain: TableOpts = { borders: "none", align: "c", header: false, float: false };

describe("tableSnippet", () => {
  it("empty grid: one tab stop per cell, LaTeX \\\\ row ends", () => {
    expect(tableSnippet(2, 3, plain)).toBe("\\begin{tabular}{ccc}\n\t${1} & ${2} & ${3} \\\\\\\\\n\t${4} & ${5} & ${6} \\\\\\\\\n\\end{tabular}\n$0");
  });

  it("booktabs float with header", () => {
    const s = tableSnippet(3, 2, DEFAULT_OPTS);
    expect(s.split("\n")).toEqual([
      "\\begin{table}[htbp]",
      "\t\\centering",
      "\t\\caption{${1:Podpis}}",
      "\t\\label{tab:${2}}",
      "\t\\begin{tabular}{ll}",
      "\t\t\\toprule",
      "\t\t${3} & ${4} \\\\\\\\",
      "\t\t\\midrule",
      "\t\t${5} & ${6} \\\\\\\\",
      "\t\t${7} & ${8} \\\\\\\\",
      "\t\t\\bottomrule",
      "\t\\end{tabular}",
      "\\end{table}",
      "$0",
    ]);
  });

  it("grid: vertical bars and a rule under every row", () => {
    const s = tableSnippet(2, 2, { ...plain, borders: "grid", align: "r" });
    expect(s).toContain("{|r|r|}");
    expect(s.match(/\\hline/g)).toHaveLength(3);
  });

  it("none + header: only the rule under the header", () => {
    expect(tableSnippet(3, 2, { ...plain, header: true }).match(/\\hline/g)).toHaveLength(1);
  });

  it("a plain selection lands in the first cell", () => {
    expect(toText(tableSnippet(1, 2, plain, undefined, true), { selection: "Wynik" })).toContain("Wynik &  \\\\");
  });

  it("literal cells are escaped, padded and survive the snippet translator", () => {
    const s = tableSnippet(0, 0, plain, [["Cena $", "50%"], ["a_b", "x"]]);
    const cm = toText(s);
    expect(cm).toContain("Cena \\$ & 50\\% \\\\");
    expect(cm).toContain("a\\_b    & x \\\\");
  });
});

describe("parseCells", () => {
  it("spreadsheet paste (tabs), ragged rows padded", () => {
    expect(parseCells("a\tb\tc\n1\t2\n")).toEqual([["a", "b", "c"], ["1", "2", ""]]);
  });
  it("CSV with ; or , over several lines, quotes dropped", () => {
    expect(parseCells('x;"y"\n1;2')).toEqual([["x", "y"], ["1", "2"]]);
    expect(parseCells("x,y\r\n1,2")).toEqual([["x", "y"], ["1", "2"]]);
  });
  it("prose is not a table", () => {
    expect(parseCells("Ala, ma kota")).toBeNull();
    expect(parseCells("jedna linia")).toBeNull();
  });
});

it("escapeLatex", () => {
  expect(escapeLatex("\\ & ~ ^ {x}")).toBe("\\textbackslash{} \\& \\textasciitilde{} \\textasciicircum{} \\{x\\}");
});
