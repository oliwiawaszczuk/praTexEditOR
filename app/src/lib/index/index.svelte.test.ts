import { describe, expect, it } from "vitest";
import { ProjectIndex, type OutlineItem } from "./index.svelte.ts";
import type { Project } from "#lib/core/projects.svelte.ts";

const o = (level: number, title: string, file: string, line: number): OutlineItem => ({ level, title, file, line });

describe("ProjectIndex crumbs", () => {
  const ix = new ProjectIndex(() => ({ id: "p" }) as Project);
  ix.snap = {
    outline: [o(1, "Wstęp", "a.tex", 1), o(1, "Metody", "a.tex", 10), o(2, "Dane", "b.tex", 1), o(2, "Analiza", "b.tex", 20), o(1, "Wyniki", "c.tex", 1)],
    labels: [],
    bib: [],
    words: 0,
    fileWords: {},
  };

  it("chain of ancestors of the section holding the line", () => {
    expect(ix.crumbs("b.tex", 25).map((c) => c.title)).toEqual(["Metody", "Analiza"]);
    expect(ix.crumbs("a.tex", 5).map((c) => c.title)).toEqual(["Wstęp"]);
  });

  it("nothing before the first section", () => {
    expect(ix.crumbs("d.tex", 3)).toEqual([]);
  });

  it("siblings stay within the parent", () => {
    const analiza = ix.snap.outline[3];
    expect(ix.siblings(analiza).map((c) => c.title)).toEqual(["Dane", "Analiza"]);
  });
});
