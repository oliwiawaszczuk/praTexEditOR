import type { Kind } from "#lib/git/git.svelte.ts";

export const STATUS_LABEL: Record<Kind, string> = {
  added: "nowy",
  modified: "zmieniony",
  deleted: "usunięty",
  renamed: "przeniesiony",
  typechange: "zmiana typu",
};

/** One letter on a file row (like every Git client). */
export const STATUS_LETTER: Record<Kind, string> = { added: "A", modified: "M", deleted: "D", renamed: "R", typechange: "T" };

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

/** Commit time → "dziś 14:05", "wczoraj", "3 d", "12 paź 2025". */
export function when(sec: number, now = Date.now()): string {
  const d = new Date(sec * 1000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const t = d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() >= start.getTime()) return `dziś ${t}`;
  if (d.getTime() >= start.getTime() - 86_400_000) return `wczoraj ${t}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("pl-PL", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
