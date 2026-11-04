import { describe, expect, it } from "vitest";
import { noteOf, resolveTarget, subjectName, subjectOf, targetKey } from "./target.ts";

const root = "/u/studia";

describe("studia target", () => {
  it("finds the subject of a file", () => {
    expect(subjectOf(root, "/u/studia/Bio/content/01_a.tex")).toBe("/u/studia/Bio");
    expect(subjectOf(root, "/u/studia/Bio/main.tex")).toBe("/u/studia/Bio");
    expect(subjectOf(root, "/u/studia/notatki.sty")).toBeNull();
    expect(subjectOf(root, "/u/studia/Bio", true)).toBe("/u/studia/Bio");
    expect(subjectOf(root, "/u/studiaX/Bio/a.tex")).toBeNull();
    expect(subjectOf(root, null)).toBeNull();
  });

  it("knows notes: only .tex directly in content/", () => {
    expect(noteOf(root, "/u/studia/Bio/content/01_a.tex")).toBe("/u/studia/Bio/content/01_a.tex");
    expect(noteOf(root, "/u/studia/Bio/content/img/x.tex")).toBeNull();
    expect(noteOf(root, "/u/studia/Bio/content/a.png")).toBeNull();
    expect(noteOf(root, "/u/studia/Bio/main.tex")).toBeNull();
  });

  it("resolves by scope, falling back to the subject", () => {
    const f = "/u/studia/Bio/content/01_a.tex";
    expect(resolveTarget(root, f, "note")).toEqual({ subject: "/u/studia/Bio", note: f });
    expect(resolveTarget(root, f, "subject")).toEqual({ subject: "/u/studia/Bio" });
    expect(resolveTarget(root, "/u/studia/Bio/main.tex", "note")).toEqual({ subject: "/u/studia/Bio" });
    expect(targetKey(resolveTarget(root, f, "note"))).toBe(`/u/studia/Bio|${f}`);
  });

  it("works with Windows separators", () => {
    const w = "C:\\studia";
    expect(subjectOf(w, "C:\\studia\\Bio\\content\\01_a.tex")).toBe("C:\\studia\\Bio");
    expect(subjectName("C:\\studia\\Bio")).toBe("Bio");
  });
});
