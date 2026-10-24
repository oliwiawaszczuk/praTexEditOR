import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { bibParser, latexParser, type TexState } from "./language.ts";

/** Tokenise lines like StreamLanguage does: [text, style][] per line (spaces dropped). */
function lex<S>(parser: typeof latexParser | typeof bibParser, src: string): [string, string | null][][] {
  const p = parser as unknown as { startState: () => S; token: (s: StringStream, st: S) => string | null; blankLine?: (st: S) => void };
  const st = p.startState();
  return src.split("\n").map((line) => {
    const out: [string, string | null][] = [];
    if (!line.trim()) {
      p.blankLine?.(st);
      return out;
    }
    const s = new StringStream(line, 4, 2);
    while (!s.eol()) {
      s.start = s.pos;
      const style = p.token(s, st);
      if (s.pos === s.start) throw new Error(`no progress at ${line}:${s.pos}`);
      const text = s.current();
      if (text.trim()) out.push([text, style]);
    }
    return out;
  });
}

const styleOf = (lines: [string, string | null][][], text: string): (string | null)[] =>
  lines.flat().filter(([t]) => t.includes(text)).map(([, s]) => s);

describe("latex tokenizer", () => {
  it("colours commands, environments, headings and keys", () => {
    const l = lex<TexState>(latexParser, "\\section*{Wstęp \\emph{nowy}}\n\\begin{figure}[h]\n\\includegraphics[width=0.5\\textwidth]{img/wykres.png}\n\\label{fig:a} zob.~\\ref{fig:a}\n\\end{figure}");
    expect(styleOf(l, "\\section*")).toEqual(["command"]);
    expect(styleOf(l, "Wstęp")).toEqual(["heading"]);
    expect(styleOf(l, "\\emph")).toEqual(["command"]);
    expect(styleOf(l, "figure")).toEqual(["env", "env"]);
    expect(styleOf(l, "img/wykres.png")).toEqual(["path"]);
    expect(styleOf(l, "width=0.5")).toEqual([null]);
    expect(styleOf(l, "fig:a")).toEqual(["key", "key"]);
    expect(styleOf(l, "zob.~")).toEqual([null]);
  });

  it("tracks inline, display and environment math", () => {
    const l = lex<TexState>(latexParser, "Niech $x_1 + ą$ oraz \\[ y \\] tekst\n\\begin{align*}\na &= b \\label{eq:1}\n\\end{align*}\npo");
    expect(styleOf(l, "x_1")).toEqual(["math"]);
    expect(styleOf(l, "$")).toEqual(["mathDelim", "mathDelim"]);
    expect(styleOf(l, "oraz")).toEqual([null]);
    expect(styleOf(l, "y")).toEqual(["math"]);
    expect(styleOf(l, "tekst")).toEqual([null]);
    expect(styleOf(l, "a &= b")).toEqual(["math"]);
    expect(styleOf(l, "eq:1")).toEqual(["key"]);
    expect(styleOf(l, "po")).toEqual([null]);
  });

  it("an unclosed $ stops at the paragraph end", () => {
    const l = lex<TexState>(latexParser, "koszt $5 za sztukę\n\nnowy akapit");
    expect(styleOf(l, "nowy akapit")).toEqual([null]);
  });

  it("comments, escapes, verbatim and urls", () => {
    const l = lex<TexState>(latexParser, "50\\% rabatu % komentarz\n\\begin{verbatim}\n$ nie matematyka % ani uwaga\n\\end{verbatim}\n\\url{http://a.pl/%7Ex} \\verb|$x$| koniec");
    expect(styleOf(l, "\\%")).toEqual(["command"]);
    expect(styleOf(l, "komentarz")).toEqual(["comment"]);
    expect(styleOf(l, "nie matematyka")).toEqual(["verbatim"]);
    expect(styleOf(l, "verbatim")).toEqual(["env", "env"]);
    expect(styleOf(l, "http://a.pl/%7Ex")).toEqual(["path"]);
    expect(styleOf(l, "$x$|")).toEqual(["verbatim"]);
    expect(styleOf(l, "koniec")).toEqual([null]);
  });
});

describe("bibtex tokenizer", () => {
  it("types, keys and fields", () => {
    const l = lex(bibParser, "@article{kowalski2020,\n  title = {O {LaTeX}u},\n  year = 2020\n}");
    expect(styleOf(l, "@article")).toEqual(["bibType"]);
    expect(styleOf(l, "kowalski2020")).toEqual(["key"]);
    expect(styleOf(l, "title")).toEqual(["bibField"]);
    expect(styleOf(l, "year")).toEqual(["bibField"]);
  });
});
