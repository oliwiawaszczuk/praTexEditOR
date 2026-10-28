import { describe, expect, it } from "vitest";
import { wordDiff } from "./wordDiff.ts";

describe("wordDiff", () => {
  it("marks only the changed words", () => {
    const d = wordDiff("Ala ma kota i psa", "Ala ma kota i chomika")!;
    expect(d.a.filter((s) => s.changed).map((s) => s.text)).toEqual(["psa"]);
    expect(d.b.filter((s) => s.changed).map((s) => s.text)).toEqual(["chomika"]);
    expect(d.a.map((s) => s.text).join("")).toBe("Ala ma kota i psa");
    expect(d.b.map((s) => s.text).join("")).toBe("Ala ma kota i chomika");
  });
  it("handles Polish letters and LaTeX commands as words", () => {
    const d = wordDiff("\\section{Wstęp}", "\\section{Wprowadzenie}")!;
    expect(d.a.filter((s) => s.changed).map((s) => s.text)).toEqual(["Wstęp"]);
  });
  it("gives up when nothing is shared or the lines are huge", () => {
    expect(wordDiff("abc", "xyz")).toBeNull();
    const big = "a ".repeat(2000);
    expect(wordDiff(big, big + "b")).toBeNull();
  });
});
