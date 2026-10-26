import { describe, expect, it } from "vitest";
import { BUILTIN } from "./builtin.ts";
import { toTemplate, toText } from "./vscode.ts";

describe("built-in snippets", () => {
  it("have unique ids and prefixes", () => {
    const ids = BUILTIN.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = BUILTIN.map((s) => s.prefix);
    expect(prefixes.filter((p, i) => prefixes.indexOf(p) !== i)).toEqual([]);
  });

  it("translate to editor templates and plain text without leftovers", () => {
    for (const s of BUILTIN) {
      expect(() => toTemplate(s.body, { selection: "" }), s.id).not.toThrow();
      const text = toText(s.body, { selection: "" });
      expect(text, s.id).not.toMatch(/\$\{|\$\d|TM_SELECTED_TEXT/);
    }
  });

  it("keep every \\begin{x} closed by \\end{x}", () => {
    for (const s of BUILTIN) {
      const text = toText(s.body, { selection: "" });
      const count = (re: RegExp) => [...text.matchAll(re)].map((m) => m[1]).sort();
      expect(count(/\\begin\{([^}]+)\}/g), s.id).toEqual(count(/\\end\{([^}]+)\}/g));
    }
  });

  it("brackets { } balance in the plain text", () => {
    for (const s of BUILTIN) {
      const text = toText(s.body, { selection: "" }).replace(/\\[{}]/g, "");
      const depth = [...text].reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
      expect(depth, s.id).toBe(0);
    }
  });

  it("every requirement names a package", () => {
    for (const s of BUILTIN.filter((x) => x.requires)) expect(s.requires, s.id).toMatch(/^[a-z0-9]+(\|[a-z0-9]+)*$/);
  });
});
