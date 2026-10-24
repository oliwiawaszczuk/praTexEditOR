import { describe, expect, it } from "vitest";
import { BUILTIN } from "./builtin.ts";
import { fieldsOf, parseSnippetFile, toTemplate, toText } from "./vscode.ts";

// Plain strings on purpose: `${…}` inside a template literal would be interpolated.
describe("VS Code snippets", () => {
  it("turns tab stops into CodeMirror fields", () => {
    expect(toTemplate("\\textbf{$1}$0")).toBe("\\textbf{${1}}${0}");
    expect(toTemplate("\\includegraphics[width=${1:0.8}\\textwidth]{${2:plik}}")).toBe("\\includegraphics[width=${1:0.8}\\textwidth]{${2:plik}}");
    expect(toTemplate("${1|article,report,book|}")).toBe("${1:article}");
  });
  it("wraps the selection", () => {
    const body = "\\textbf{${1:$TM_SELECTED_TEXT}}";
    expect(toTemplate(body, { selection: "ważne" })).toBe("\\textbf{${1:ważne}}");
    expect(toTemplate(body)).toBe("\\textbf{${1}}");
    // Braces cannot be a field default: text + empty field.
    expect(toTemplate(body, { selection: "a \\emph{b}" })).toBe("\\textbf{a \\emph{b}${1}}");
  });
  it("handles escapes and variables", () => {
    expect(toTemplate("\\\\$1 \\$ \\}")).toBe("\\${1} $ }");
    expect(toTemplate("${CURRENT_YEAR}-$CURRENT_MONTH", { now: new Date(2026, 9, 23) })).toBe("2026-10");
    expect(toTemplate("${UNKNOWN:x}")).toBe("x");
    expect(toTemplate("${TM_SELECTED_TEXT/(.*)/$1/}a")).toBe("a");
  });
  it("gives plain text and field ranges for previews", () => {
    const body = "\\section{${1:Tytuł}}\\label{sec:$2}";
    expect(toText(body)).toBe("\\section{Tytuł}\\label{sec:}");
    expect(fieldsOf(body)).toEqual([
      { from: 9, to: 14, n: 1 },
      { from: 26, to: 26, n: 2 },
    ]);
  });
  it("reads VS Code snippet files", () => {
    const r = parseSnippetFile({ Bold: { prefix: ["bf"], body: ["\\textbf{$1}", "$0"], description: "x" }, Bad: 3 });
    expect(r).toEqual([{ name: "Bold", prefix: "bf", body: "\\textbf{$1}\n$0", description: "x" }]);
  });
});

describe("built-in snippets", () => {
  it("have unique ids and prefixes and translate cleanly", () => {
    expect(new Set(BUILTIN.map((s) => s.id)).size).toBe(BUILTIN.length);
    expect(new Set(BUILTIN.map((s) => s.prefix)).size).toBe(BUILTIN.length);
    for (const s of BUILTIN) expect(toTemplate(s.body)).not.toContain("$TM_");
  });
  it("keep LaTeX line breaks and math", () => {
    const ali = BUILTIN.find((s) => s.id === "align")!;
    expect(toText(ali.body)).toContain("a &= b \\\\\n");
    expect(toTemplate(BUILTIN.find((s) => s.id === "math")!.body, { selection: "x^2" })).toBe("$${1:x^2}$${0}");
    expect(toTemplate(BUILTIN.find((s) => s.id === "newcommand")!.body)).toBe("\\newcommand{\\${1:nazwa}}[${2:0}]{${3:treść}}${0}");
  });
});
