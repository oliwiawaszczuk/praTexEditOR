// Word-level difference inside a changed line (long LaTeX lines: show WHAT changed).

export interface Seg {
  text: string;
  changed: boolean;
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
/** tokens(a) × tokens(b) above this → skip (the whole line stays highlighted). */
const BUDGET = 160_000;

const tokens = (s: string): string[] => s.match(TOKEN) ?? [];

function merge(parts: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.changed === p.changed) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** Segments of `a` and of `b`; null when the lines are too long to compare cheaply
 * or share nothing worth showing. */
export function wordDiff(a: string, b: string): { a: Seg[]; b: Seg[] } | null {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length * y.length > BUDGET) return null;
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const sa: Seg[] = [];
  const sb: Seg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      sa.push({ text: x[i], changed: false });
      sb.push({ text: y[j], changed: false });
      i++;
      j++;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) sa.push({ text: x[i++], changed: true });
    else sb.push({ text: y[j++], changed: true });
  }
  while (i < n) sa.push({ text: x[i++], changed: true });
  while (j < m) sb.push({ text: y[j++], changed: true });
  const common = t[0];
  if (common === 0) return null;
  return { a: merge(sa), b: merge(sb) };
}
