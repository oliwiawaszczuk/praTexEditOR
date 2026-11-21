// SyncTeX knows lines, not words (pdfLaTeX writes no column). The word is matched on
// both sides by its text: the source line (CodeMirror) and the PDF text layer (pdf.js).
// Pure functions, shared by the editor and PDF chunks.

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

const isWord = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c);

/** Lowercase, accents and ligatures folded (ą → a, ﬁ → fi); `map[i]` = index in `s` of output char i. */
export function fold(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i) as number);
    const f = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    text += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  return { text, map };
}

/** Whole-word occurrences of `word` in `s` as [from, to) of `s`; `source`: skip macro names (`\word`). */
export function occurrences(s: string, word: string, source = false): [number, number][] {
  const w = fold(word).text;
  if (!w) return [];
  const { text, map } = fold(s);
  const out: [number, number][] = [];
  for (let k = text.indexOf(w); k >= 0; k = text.indexOf(w, k + 1)) {
    let e = k + w.length;
    if (isWord(text[k - 1]) || isWord(text[e])) continue;
    const from = map[k];
    if (source && s[from - 1] === "\\") continue;
    while (e < map.length && map[e] === map[e - 1]) e++;
    out.push([from, e < map.length ? map[e] : s.length]);
  }
  return out;
}

/** The word run around `off` (or just before it): [from, to) of `s`. */
function runAt(s: string, off: number): [number, number] | null {
  let at = off;
  if (!isWord(s[at])) at--;
  if (!isWord(s[at])) return null;
  let from = at;
  let to = at + 1;
  while (from > 0 && isWord(s[from - 1])) from--;
  while (to < s.length && isWord(s[to])) to++;
  return [from, to];
}

export interface WordHint {
  word: string;
  /** How many equal words come before it in its line (the k-th occurrence). */
  ordinal: number;
}

/** The word at column `col` of a source line; null on a macro name, a formula char, a space. */
export function wordInSource(line: string, col: number): WordHint | null {
  const run = runAt(line, col);
  if (!run || line[run[0] - 1] === "\\") return null;
  const word = line.slice(run[0], run[1]);
  const ordinal = occurrences(line, word, true).filter(([f]) => f < run[0]).length;
  return { word, ordinal };
}

/** The word at offset `off` of plain text. */
export function wordAt(s: string, off: number): { word: string; from: number; to: number } | null {
  const run = runAt(s, off);
  return run ? { word: s.slice(run[0], run[1]), from: run[0], to: run[1] } : null;
}

/** Source lines around the SyncTeX one: the word on line `center` (its `ordinal`-th
 * occurrence), else the nearest line with it (above: its last, below: its first). */
export function locateInSource(lines: { n: number; text: string }[], center: number, hint: WordHint): { n: number; from: number; to: number } | null {
  for (const d of [0, -1, 1, -2, 2]) {
    const l = lines.find((x) => x.n === center + d);
    if (!l) continue;
    const occ = occurrences(l.text, hint.word, true);
    if (!occ.length) continue;
    const [from, to] = d === 0 ? occ[Math.min(hint.ordinal, occ.length - 1)] : d < 0 ? occ[occ.length - 1] : occ[0];
    return { n: l.n, from, to };
  }
  return null;
}

/** A run of PDF text (one text node of the text layer); `end`: what follows it. */
export interface Piece {
  text: string;
  /** "eol" = end of an output line (a trailing hyphen is a word split), "gap" = skipped text. */
  end: "" | "eol" | "gap";
}

/** Pieces as one string; `at[i]` = [piece, offset] of char i. Hyphenated words are rejoined. */
export function joinPieces(pieces: Piece[]): { text: string; at: [number, number][] } {
  let text = "";
  const at: [number, number][] = [];
  pieces.forEach((p, i) => {
    let t = p.text;
    if (p.end === "eol" && /[-­]$/.test(t) && isWord(t[t.length - 2])) t = t.slice(0, -1);
    else if (p.end) t += " ";
    for (let k = 0; k < t.length; k++) at.push([i, Math.min(k, p.text.length)]);
    text += t;
  });
  return { text, at };
}

/** The `ordinal`-th occurrence of `word` in the pieces (clamped) as piece positions [from, to). */
export function findInPieces(pieces: Piece[], word: string, ordinal: number): { from: [number, number]; to: [number, number] } | null {
  const { text, at } = joinPieces(pieces);
  const occ = occurrences(text, word);
  if (!occ.length) return null;
  const [f, t] = occ[Math.min(ordinal, occ.length - 1)];
  const last = at[t - 1];
  return { from: at[f], to: [last[0], last[1] + 1] };
}

/** How many occurrences of `word` start before piece position (piece, off). */
export function ordinalInPieces(pieces: Piece[], word: string, piece: number, off: number): number {
  const { text, at } = joinPieces(pieces);
  return occurrences(text, word).filter(([f]) => at[f][0] < piece || (at[f][0] === piece && at[f][1] < off)).length;
}
