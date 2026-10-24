// Fuzzy matching for the palette: the query's letters in order, anywhere in the text.
// Higher score = better: consecutive letters, word starts and an early match count.

export interface Match {
  score: number;
  /** Matched character positions (for highlighting). */
  hits: number[];
}

const isStart = (s: string, i: number): boolean => i === 0 || /[\s/\\._\-:]/.test(s[i - 1]) || (s[i] >= "A" && s[i] <= "Z" && s[i - 1] >= "a" && s[i - 1] <= "z");

export function fuzzy(query: string, text: string): Match | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  // Exact substring: best, and its hits are contiguous.
  const at = t.indexOf(q);
  if (at >= 0) {
    return { score: 1000 - at + (isStart(text, at) ? 200 : 0) + (q.length === t.length ? 500 : 0), hits: [...q].map((_, i) => at + i) };
  }
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    // Prefer the next word start that has the letter, else the first occurrence.
    let i = -1;
    for (let k = from; k < t.length; k++) {
      if (t[k] === ch && isStart(text, k)) {
        i = k;
        break;
      }
    }
    const plain = t.indexOf(ch, from);
    if (i < 0 || (plain >= 0 && hits.length && plain === hits[hits.length - 1] + 1)) i = plain;
    if (i < 0) return null;
    score += isStart(text, i) ? 30 : 1;
    if (hits.length && i === hits[hits.length - 1] + 1) score += 15;
    score -= Math.min(10, i - from);
    hits.push(i);
    from = i + 1;
  }
  return { score, hits };
}

/** Best first; ties keep the input order (recent files first). */
export function rank<T>(items: T[], query: string, key: (x: T) => string, limit = 60): { item: T; match: Match }[] {
  const out: { item: T; match: Match; i: number }[] = [];
  items.forEach((item, i) => {
    const m = fuzzy(query, key(item));
    if (m) out.push({ item, match: m, i });
  });
  out.sort((a, b) => b.match.score - a.match.score || a.i - b.i);
  return out.slice(0, limit);
}
