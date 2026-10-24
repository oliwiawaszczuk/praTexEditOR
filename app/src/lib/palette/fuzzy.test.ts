import { describe, expect, it } from "vitest";
import { fuzzy, rank } from "./fuzzy.ts";

describe("fuzzy", () => {
  it("matches letters in order", () => {
    expect(fuzzy("mtx", "main.tex")).not.toBeNull();
    expect(fuzzy("xtm", "main.tex")).toBeNull();
    expect(fuzzy("", "x")?.score).toBe(0);
  });
  it("prefers substrings, word starts and short distances", () => {
    const files = ["rozdzialy/02-metody.tex", "main.tex", "metody-stare/inne.tex", "img/wykres-metody.png"];
    expect(rank(files, "metody", (x) => x)[0].item).toBe("metody-stare/inne.tex");
    expect(rank(files, "main", (x) => x)[0].item).toBe("main.tex");
    expect(rank(["Zapisz i kompiluj", "Zamknij kartę", "Zawijanie wierszy"], "zk", (x) => x)[0].item).toBe("Zamknij kartę");
  });
  it("returns hit positions for highlighting", () => {
    expect(fuzzy("mt", "main.tex")?.hits).toEqual([0, 5]);
  });
});
