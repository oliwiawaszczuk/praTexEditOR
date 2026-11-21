// Table generator (docs/02-plan.md "Później"): rows × columns + style → a VS Code snippet
// body (`tabular`, optionally inside a `table` float). Empty cells are tab stops; cells
// taken from a pasted spreadsheet (tab / ; / , separated text) are literal, LaTeX-escaped
// and padded so the `&` line up. Pure: tested without the editor.

export type Borders = "none" | "rows" | "booktabs" | "grid";
export type Align = "l" | "c" | "r";

export interface TableOpts {
  borders: Borders;
  align: Align;
  /** First row is a header (a rule under it). */
  header: boolean;
  /** Wrap in `table` with `\caption` and `\label`. */
  float: boolean;
}

export const DEFAULT_OPTS: TableOpts = { borders: "booktabs", align: "l", header: true, float: true };
export const MAX_ROWS = 10;
export const MAX_COLS = 8;

/** Snippet syntax: `\`, `$` and `}` are special in literal text. */
const lit = (s: string) => s.replace(/[\\$}]/g, (c) => "\\" + c);

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
export const escapeLatex = (s: string) => s.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c]);

/** Cells of a pasted table (spreadsheet: tabs; CSV: `;` or `,`), null when the text is not one. */
export function parseCells(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  // `;` / `,` only over several lines: a sentence with a comma is not a table.
  const sep = ["\t", ";", ","].find((s) => (s === "\t" ? text.includes(s) : lines.length > 1 && lines.every((l) => l.includes(s))));
  if (!sep) return null;
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1")));
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 2 && rows.length < 2) return null;
  return rows.map((r) => [...r, ...Array<string>(cols - r.length).fill("")]);
}

/** Packages the style needs (for `ensurePackages`). */
export const requiresOf = (o: TableOpts) => (o.borders === "booktabs" ? "booktabs" : undefined);

/** `keepSelection`: the selected text goes into the first cell (the snippet replaces the selection). */
export function tableSnippet(rows: number, cols: number, o: TableOpts, cells?: string[][], keepSelection = false): string {
  if (cells) {
    rows = cells.length;
    cols = cells[0]?.length ?? 0;
  }
  const ind = o.float ? "\t\t" : "\t";
  let stop = 1;
  const out: string[] = [];
  if (o.float) {
    out.push("\\begin{table}[htbp]", "\t\\centering", `\t\\caption{\${${stop++}:Podpis}}`, `\t\\label{tab:\${${stop++}}}`);
  }
  const spec = o.borders === "grid" ? `|${Array(cols).fill(o.align).join("|")}|` : o.align.repeat(cols);
  out.push(`${o.float ? "\t" : ""}\\begin{tabular}{${spec}}`);
  const rule = (kind: "top" | "mid" | "bottom" | "row") => {
    const b = o.borders;
    if (b === "booktabs") return kind === "row" ? null : `\\${kind}rule`;
    if (b === "rows" || b === "grid") return "\\hline";
    return kind === "mid" ? "\\hline" : null; // none: only the header rule
  };
  const push = (r: string | null) => r && out.push(ind + r);

  // Literal cells: pad every column to its widest (escaped) text.
  const text = cells?.map((r) => r.map(escapeLatex));
  const width = text ? Array.from({ length: cols }, (_, c) => Math.max(...text.map((r) => r[c].length))) : [];

  push(rule("top"));
  for (let r = 0; r < rows; r++) {
    const row = text
      ? text[r].map((c, i) => lit(i < cols - 1 ? c.padEnd(width[i]) : c)).join(" & ")
      : Array.from({ length: cols }, (_, c) => (keepSelection && r === 0 && c === 0 ? "$TM_SELECTED_TEXT" : `\${${stop++}}`)).join(" & ");
    out.push(`${ind}${row} \\\\\\\\`);
    if (r === rows - 1) push(rule("bottom"));
    else if (r === 0 && o.header) push(rule("mid"));
    else push(rule("row"));
  }
  out.push(`${o.float ? "\t" : ""}\\end{tabular}`);
  if (o.float) out.push("\\end{table}");
  return out.join("\n") + "\n$0";
}
