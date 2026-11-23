import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { mathAt } from "./formula.ts";

const at = (doc: string, marker = "|") => {
  const pos = doc.indexOf(marker);
  return mathAt(EditorState.create({ doc: doc.replace(marker, "") }), pos);
};

describe("mathAt", () => {
  it("finds inline math", () => {
    expect(at("tekst $a^2 + |b^2$ dalej")?.tex).toBe("a^2 + b^2");
  });
  it("ignores text outside math and escaped dollars", () => {
    expect(at("cena 5\\$ i |tekst")).toBeNull();
  });
  it("finds display math and environments", () => {
    expect(at("\\[ x |= 1 \\]")?.display).toBe(true);
    const h = at("\\begin{align}\na &= 1 \\label{x}| \\\\\nb &= 2\n\\end{align}");
    expect(h?.tex).toBe("\\begin{aligned}a &= 1  \\\\\nb &= 2\\end{aligned}");
  });
  it("finds mhchem \\ce in running text, arrows stay plain characters", () => {
    const h = at("Reakcja \\ce{2H2 + O2 -|> 2H2O} dalej");
    expect(h?.tex).toBe("\\ce{2H2 + O2 -> 2H2O}");
    expect(h?.display).toBe(false);
    expect(at("\\ce{[Cu(NH3)4]^2+ <=|> x} i $a$")?.tex).toBe("\\ce{[Cu(NH3)4]^2+ <=> x}");
    expect(at("a \\ce{H2O} b|")).toBeNull();
    expect(at("$\\ce{A -|> B}$")?.tex).toBe("\\ce{A -> B}");
  });
  it("skips comments", () => {
    expect(at("% $a|$\n")).toBeNull();
  });
});
