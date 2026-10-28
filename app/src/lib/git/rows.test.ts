import { describe, expect, it } from "vitest";
import { hunkStarts, split, unified } from "./rows.ts";
import type { Hunk } from "./git.svelte.ts";

const L = (kind: " " | "+" | "-", text: string, old: number | null, nw: number | null) => ({ kind, text, old, new: nw });
const hunk: Hunk = {
  header: "@@ -1,3 +1,3 @@",
  oldStart: 1,
  newStart: 1,
  lines: [L(" ", "a", 1, 1), L("-", "b", 2, null), L("-", "c", 3, null), L("+", "B", null, 2), L(" ", "d", 4, 3)],
};

describe("rows", () => {
  it("labels hunks in words, not @@ numbers", () => {
    expect(unified([hunk])[0]).toEqual({ t: "hunk", h: 0, text: "Zmiana 1 z 1 · linie 1–3" });
  });
  it("unified: dels then adds, mates by position", () => {
    const rows = unified([hunk]);
    expect(rows.map((r) => (r.t === "hunk" ? "@" : r.line.kind))).toEqual(["@", " ", "-", "-", "+", " "]);
    const b = rows[2];
    expect(b.t === "line" && b.mate?.text).toBe("B");
    const c = rows[3];
    expect(c.t === "line" && c.mate).toBeNull();
  });
  it("split: pairs removed with added", () => {
    const rows = split([hunk]);
    expect(rows).toHaveLength(5);
    const p = rows[3];
    expect(p.t === "pair" && [p.l?.text, p.r?.text]).toEqual(["c", undefined]);
    expect(hunkStarts(rows)).toEqual([0]);
  });
});
