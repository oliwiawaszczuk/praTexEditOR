// Hunks → the flat rows the diff view draws (so it can window them: 20 px each).

import type { Hunk, Line } from "./git.svelte.ts";

export type URow =
  | { t: "hunk"; h: number; text: string }
  | { t: "line"; h: number; line: Line; mate: Line | null };
export type SRow =
  | { t: "hunk"; h: number; text: string }
  | { t: "pair"; h: number; l: Line | null; r: Line | null };

/** "Zmiana 2 z 5 · linie 40–52" instead of git's `@@ -40,6 +40,9 @@`. */
export function hunkLabel(hk: Hunk, h: number, total: number): string {
  const nums = hk.lines.map((l) => l.new ?? l.old).filter((n): n is number => n !== null);
  const from = nums.length ? Math.min(...nums) : hk.newStart;
  const to = nums.length ? Math.max(...nums) : hk.newStart;
  return `Zmiana ${h + 1} z ${total} · ${from === to ? `linia ${from}` : `linie ${from}–${to}`}`;
}

/** Unified rows; each removed/added line gets its counterpart (same position in the
 * block) as `mate`, for word-level highlighting. */
export function unified(hunks: Hunk[]): URow[] {
  const out: URow[] = [];
  hunks.forEach((hk, h) => {
    out.push({ t: "hunk", h, text: hunkLabel(hk, h, hunks.length) });
    let i = 0;
    while (i < hk.lines.length) {
      const ln = hk.lines[i];
      if (ln.kind === " ") {
        out.push({ t: "line", h, line: ln, mate: null });
        i++;
        continue;
      }
      const dels: Line[] = [];
      const adds: Line[] = [];
      while (i < hk.lines.length && hk.lines[i].kind === "-") dels.push(hk.lines[i++]);
      while (i < hk.lines.length && hk.lines[i].kind === "+") adds.push(hk.lines[i++]);
      dels.forEach((d, k) => out.push({ t: "line", h, line: d, mate: adds[k] ?? null }));
      adds.forEach((a, k) => out.push({ t: "line", h, line: a, mate: dels[k] ?? null }));
    }
  });
  return out;
}

/** Side-by-side rows: removed on the left, added on the right, paired by position. */
export function split(hunks: Hunk[]): SRow[] {
  const out: SRow[] = [];
  hunks.forEach((hk, h) => {
    out.push({ t: "hunk", h, text: hunkLabel(hk, h, hunks.length) });
    let i = 0;
    while (i < hk.lines.length) {
      const ln = hk.lines[i];
      if (ln.kind === " ") {
        out.push({ t: "pair", h, l: ln, r: ln });
        i++;
        continue;
      }
      const dels: Line[] = [];
      const adds: Line[] = [];
      while (i < hk.lines.length && hk.lines[i].kind === "-") dels.push(hk.lines[i++]);
      while (i < hk.lines.length && hk.lines[i].kind === "+") adds.push(hk.lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ t: "pair", h, l: dels[k] ?? null, r: adds[k] ?? null });
    }
  });
  return out;
}

/** Index of the first row of every hunk (for "next / previous change"). */
export const hunkStarts = (rows: { t: string }[]): number[] => rows.flatMap((r, i) => (r.t === "hunk" ? [i] : []));
