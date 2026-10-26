import { describe, expect, it } from "vitest";
import { rank } from "#lib/palette/fuzzy.ts";
import { BUILTIN, keywordsOf } from "./builtin.ts";

const find = (q: string) => rank(BUILTIN, q, (s) => `${s.title} ${keywordsOf(s)}`).map((r) => r.item.id);

describe("snippet search", () => {
  it("finds figures and images by English words", () => {
    expect(find("image")).toEqual(expect.arrayContaining(["figure", "includegraphics"]));
    expect(find("table").slice(0, 3)).toContain("table");
  });

  it("still finds by Polish title and by prefix", () => {
    expect(find("tabela")).toContain("table");
    expect(find("obraz")).toContain("includegraphics");
    expect(find("fig")).toContain("figure");
  });

  it("every built-in has English words", () => {
    for (const s of BUILTIN) expect(keywordsOf(s).split(" ").length, s.id).toBeGreaterThan(1);
  });
});
