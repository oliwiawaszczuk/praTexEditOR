// LaTeX (and BibTeX) language for CodeMirror — the only place that knows the grammar
// (docs/02-plan.md §4). `lang-tex` failed the E2 trial (0.0.3, built on the pre-release
// @codemirror/next 0.13) and `codemirror-lang-latex` is AGPL, so this is a small stream
// tokenizer of our own: it tracks what the editor needs to colour — commands, environment
// names, section titles, label/ref/cite keys, file paths, math (inline, display and math
// environments) and verbatim blocks. StreamLanguage caches the state per line, so edits
// re-tokenise from the changed line on, and only up to the viewport.

import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
import { Tag, tags } from "@lezer/highlight";

/** Highlight tags (theme.ts maps them to the --syn-* tokens). */
export const T = {
  command: Tag.define(tags.keyword),
  env: Tag.define(tags.className),
  heading: Tag.define(tags.heading),
  key: Tag.define(tags.labelName),
  path: Tag.define(tags.string),
  math: Tag.define(tags.content),
  mathDelim: Tag.define(tags.processingInstruction),
  verbatim: Tag.define(tags.monospace),
  bibType: Tag.define(tags.typeName),
  bibField: Tag.define(tags.propertyName),
};

type Arg = "heading" | "env" | "key" | "path" | "url";

export interface TexState {
  /** Inside math: the closing delimiter ("$", "$$", "\\)", "\\]") or the environment name. */
  math: string | null;
  /** Inside a verbatim-like environment (its name). */
  verbatim: string | null;
  /** The last command takes an argument we colour; waiting for its "{". */
  pending: Arg | null;
  /** Inside "[…]" between such a command and its "{". */
  opt: boolean;
  /** The argument being read and its brace depth. */
  arg: Arg | null;
  depth: number;
  /** begin/end: which one, and the environment name read so far. */
  envOf: "begin" | "end" | null;
  envName: string;
  /** \verb delimiter while inside \verb|…|. */
  verbDelim: string | null;
}

const ARG_OF: Record<string, Arg> = {};
for (const c of ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph", "frametitle", "title"]) ARG_OF[c] = "heading";
for (const c of ["begin", "end"]) ARG_OF[c] = "env";
for (const c of [
  "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "vref",
  "cite", "citep", "citet", "citealp", "citealt", "parencite", "textcite", "autocite", "footcite", "nocite", "citeauthor", "citeyear", "fullcite",
  "usepackage", "RequirePackage", "documentclass", "usetheme", "usecolortheme",
]) ARG_OF[c] = "key";
for (const c of ["input", "include", "includeonly", "subfile", "includegraphics", "bibliography", "addbibresource", "includepdf", "lstinputlisting", "inputminted"]) ARG_OF[c] = "path";
for (const c of ["url", "href"]) ARG_OF[c] = "url";

const MATH_ENVS = new Set(
  ["equation", "align", "gather", "multline", "eqnarray", "flalign", "alignat", "math", "displaymath", "dmath"].flatMap((e) => [e, `${e}*`]),
);
const VERBATIM_ENVS = new Set(["verbatim", "verbatim*", "Verbatim", "BVerbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*", "luacode", "pycode"]);

const ARG_STYLE: Record<Arg, string> = { heading: "heading", env: "env", key: "key", path: "path", url: "path" };

function startState(): TexState {
  return { math: null, verbatim: null, pending: null, opt: false, arg: null, depth: 0, envOf: null, envName: "", verbDelim: null };
}

/** Closing "}" of \begin{…} / \end{…}: switch math / verbatim mode. */
function envDone(s: TexState): void {
  const name = s.envName.trim();
  if (s.envOf === "begin") {
    if (VERBATIM_ENVS.has(name)) s.verbatim = name;
    else if (MATH_ENVS.has(name) && !s.math) s.math = name;
  } else if (s.envOf === "end" && s.math === name) {
    s.math = null;
  }
  s.envOf = null;
  s.envName = "";
}

function token(stream: Parameters<StreamParser<TexState>["token"]>[0], s: TexState): string | null {
  // \verb|…|
  if (s.verbDelim) {
    const end = stream.string.indexOf(s.verbDelim, stream.pos);
    if (end < 0) stream.skipToEnd();
    else {
      stream.pos = end + 1;
      s.verbDelim = null;
    }
    return "verbatim";
  }

  // Verbatim environment: raw until \end{name}.
  if (s.verbatim) {
    const close = `\\end{${s.verbatim}}`;
    if (stream.match("\\end")) {
      if (stream.string.startsWith(close, stream.pos - 4)) {
        s.verbatim = null;
        s.pending = "env";
        s.envOf = "end";
        return "command";
      }
      return "verbatim";
    }
    const at = stream.string.indexOf(close, stream.pos);
    if (at < 0) stream.skipToEnd();
    else stream.pos = at;
    return s.verbatim === "comment" ? "comment" : "verbatim";
  }

  // URL argument: raw until "}" (a "%" in a URL is not a comment).
  if (s.arg === "url") {
    if (stream.eat("}")) {
      s.arg = null;
      s.depth = 0;
      return "bracket";
    }
    stream.eatWhile(/[^}]/);
    return "path";
  }

  if (s.pending) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === "{" && !s.opt) {
      stream.next();
      s.arg = s.pending;
      s.depth = 1;
      if (s.arg === "env") s.envName = "";
      s.pending = null;
      s.opt = false;
      return "bracket";
    }
    if (ch === "[" && !s.opt) {
      stream.next();
      s.opt = true;
      return "bracket";
    }
    if (ch === "]" && s.opt) {
      stream.next();
      s.opt = false;
      return "bracket";
    }
    if (!s.opt) {
      s.pending = null;
      s.envOf = null;
    }
  }

  const textStyle = (): string | null => (s.arg && !s.opt ? ARG_STYLE[s.arg] : s.math ? "math" : null);

  if (stream.eat("%")) {
    stream.skipToEnd();
    return "comment";
  }

  if (stream.peek() === "\\") {
    // Math delimiters \( \) \[ \]
    if (stream.match("\\(") || stream.match("\\[")) {
      if (!s.math) s.math = stream.current() === "\\(" ? "\\)" : "\\]";
      return "mathDelim";
    }
    if ((s.math === "\\)" && stream.match("\\)")) || (s.math === "\\]" && stream.match("\\]"))) {
      s.math = null;
      return "mathDelim";
    }
    const m = stream.match(/^\\[a-zA-Z@]+\*?/) as RegExpMatchArray | null;
    if (m) {
      const name = m[0].slice(1).replace(/\*$/, "");
      if (name === "verb") {
        const d = stream.next();
        if (d) s.verbDelim = d;
        return "command";
      }
      const arg = ARG_OF[name];
      if (arg && !s.arg) {
        s.pending = arg;
        s.opt = false;
        if (arg === "env") s.envOf = name as "begin" | "end";
      }
      return "command";
    }
    stream.next();
    stream.next(); // escaped char: \\ \{ \$ \% \& \, …
    return "command";
  }

  const ch = stream.next() as string;

  if (ch === "$") {
    if (s.math === "$$" && stream.eat("$")) {
      s.math = null;
      return "mathDelim";
    }
    if (s.math === "$") {
      s.math = null;
      return "mathDelim";
    }
    if (!s.math && !s.arg) {
      s.math = stream.eat("$") ? "$$" : "$";
      return "mathDelim";
    }
    return textStyle();
  }

  if (ch === "{" || ch === "}") {
    if (s.arg) {
      s.depth += ch === "{" ? 1 : -1;
      if (s.depth === 0) {
        if (s.arg === "env") envDone(s);
        s.arg = null;
      }
    }
    return s.math && !s.arg ? "math" : "bracket";
  }
  if (ch === "[" || ch === "]") return s.math ? "math" : "bracket";

  if (s.arg === "env") {
    stream.eatWhile(/[^{}\\%\s]/);
    s.envName += stream.current();
    return "env";
  }
  stream.eatWhile(/[^\\{}[\]$%]/);
  return textStyle();
}

export const latexParser: StreamParser<TexState> = {
  name: "latex",
  startState,
  copyState: (s) => ({ ...s }),
  token,
  blankLine(s) {
    // An empty line ends a paragraph: TeX itself would stop an unclosed $ or title here,
    // so one typo does not colour the rest of the document.
    if (s.math === "$" || s.math === "$$") s.math = null;
    s.pending = null;
    s.opt = false;
    if (s.arg !== "env") {
      s.arg = null;
      s.depth = 0;
    }
  },
  languageData: {
    commentTokens: { line: "%" },
    closeBrackets: { brackets: ["{", "[", "$"] },
    wordChars: "@",
  },
  tokenTable: {
    command: T.command,
    env: T.env,
    heading: T.heading,
    key: T.key,
    path: T.path,
    math: T.math,
    mathDelim: T.mathDelim,
    verbatim: T.verbatim,
    comment: tags.comment,
    bracket: tags.bracket,
  },
};

// ── BibTeX: @type{key, field = {…}} ─────────────────────────────────────────

interface BibState {
  depth: number;
  /** After "@type{": the next word is the key. */
  wantKey: boolean;
}

export const bibParser: StreamParser<BibState> = {
  name: "bibtex",
  startState: () => ({ depth: 0, wantKey: false }),
  copyState: (s) => ({ ...s }),
  token(stream, s) {
    if (stream.eatSpace()) return null;
    if (s.depth === 0) {
      if (stream.match(/^@[a-zA-Z]+/)) return "bibType";
      if (stream.eat("{") || stream.eat("(")) {
        s.depth = 1;
        s.wantKey = true;
        return "bracket";
      }
      stream.skipToEnd(); // free text between entries is a comment in BibTeX
      return "comment";
    }
    if (s.wantKey && stream.match(/^[^,\s}]+/)) {
      s.wantKey = false;
      return "key";
    }
    if (s.depth === 1 && stream.match(/^[a-zA-Z_-]+(?=\s*=)/)) return "bibField";
    const ch = stream.next() as string;
    if (ch === "{" || ch === "(") {
      s.depth++;
      return "bracket";
    }
    if (ch === "}" || ch === ")") {
      s.depth = Math.max(0, s.depth - 1);
      return "bracket";
    }
    if (ch === "\\") {
      stream.match(/^[a-zA-Z]+|^./);
      return "command";
    }
    if (ch === "%" && s.depth <= 1) {
      stream.skipToEnd();
      return "comment";
    }
    stream.eatWhile(/[^{}()\\,%=]/);
    return s.depth > 1 ? null : "path";
  },
  languageData: { commentTokens: { line: "%" }, closeBrackets: { brackets: ["{", "(", '"'] } },
  tokenTable: { bibType: T.bibType, bibField: T.bibField, key: T.key, command: T.command, path: T.path, comment: tags.comment, bracket: tags.bracket },
};

const latexLang = StreamLanguage.define(latexParser);
const bibLang = StreamLanguage.define(bibParser);

export type LangId = "latex" | "bibtex" | "plain";

export function langFor(name: string): LangId {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["tex", "sty", "cls", "ltx", "dtx", "ins", "bbx", "cbx", "lbx", "def", "tikz"].includes(ext)) return "latex";
  if (ext === "bib") return "bibtex";
  return "plain";
}

export function language(id: LangId): LanguageSupport | [] {
  if (id === "latex") return new LanguageSupport(latexLang);
  if (id === "bibtex") return new LanguageSupport(bibLang);
  return [];
}
