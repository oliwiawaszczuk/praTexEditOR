// Snippet prefixes (`fig` + Tab) and completion after `\` (docs/03-ux.md §5):
// ƒ commands, ▢ environments (`\begin{` → the matching `\end{}` with the cursor
// inside), » snippets with a preview of what they insert. `\ref{`, `\cite{`, `\input{`
// and `\includegraphics{` complete from the project index (E6): labels with their line,
// bibliography cards (authors, year, title), files with an image thumbnail.

import { autocompletion, hasNextSnippetField, snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { Prec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { currentProject } from "#lib/core/projects.svelte.ts";
import { call, protoUrl } from "#lib/core/tauri.ts";
import { activeIndex } from "#lib/index/index.svelte.ts";
import { snippets } from "#lib/snippets/store.svelte.ts";
import { toTemplate, toText } from "#lib/snippets/vscode.ts";

const COMMANDS = [
  "textbf", "textit", "underline", "emph", "texttt", "textsc", "footnote", "section", "subsection", "subsubsection",
  "chapter", "part", "paragraph", "caption", "label", "ref", "eqref", "pageref", "cite", "citep", "citet", "item",
  "begin", "end", "frac", "dfrac", "sqrt", "sum", "prod", "int", "iint", "oint", "lim", "infty", "partial", "nabla",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "lambda", "mu", "nu",
  "xi", "pi", "rho", "sigma", "tau", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Sigma",
  "Phi", "Psi", "Omega", "cdot", "cdots", "ldots", "times", "div", "pm", "mp", "leq", "geq", "neq", "approx", "equiv",
  "sim", "propto", "in", "notin", "subset", "subseteq", "cup", "cap", "forall", "exists", "to", "rightarrow",
  "Rightarrow", "leftrightarrow", "Leftrightarrow", "mapsto", "mathbf", "mathrm", "mathcal", "mathbb", "mathit",
  "operatorname", "text", "left", "right", "big", "Big", "hat", "bar", "vec", "tilde", "dot", "ddot", "overline",
  "underbrace", "overbrace", "hline", "toprule", "midrule", "bottomrule", "multicolumn", "multirow", "centering",
  "includegraphics", "maketitle", "tableofcontents", "listoffigures", "listoftables", "usepackage", "documentclass",
  "newcommand", "renewcommand", "input", "include", "bibliography", "bibliographystyle", "printbibliography",
  "addbibresource", "textwidth", "linewidth", "hspace", "vspace", "newline", "newpage", "clearpage", "noindent",
  "url", "href", "small", "large", "Large", "LARGE", "footnotesize", "tiny", "huge", "today", "author", "title", "date",
  "frametitle", "pause", "quad", "qquad", "displaystyle", "limits",
];

const ENVS = [
  "itemize", "enumerate", "description", "equation", "equation*", "align", "align*", "gather", "gather*", "multline",
  "cases", "matrix", "pmatrix", "bmatrix", "figure", "table", "tabular", "center", "flushleft", "flushright", "quote",
  "verbatim", "lstlisting", "minipage", "abstract", "theorem", "lemma", "proof", "definition", "frame", "block",
  "columns", "column", "document", "thebibliography",
];

const commandOptions: Completion[] = COMMANDS.map((c) => ({ label: `\\${c}`, type: "function" }));

function envOptions(): Completion[] {
  return ENVS.map((e) => ({
    label: e,
    type: "env",
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      // `\begin{|` → `\begin{name}` + body line + `\end{name}`; a typed `}` is eaten.
      const end = view.state.sliceDoc(to, to + 1) === "}" ? to + 1 : to;
      snippet(`${e}}\n\t\${0}\n\\end{${e}}`)(view, null, from, end);
    },
  }));
}

function snippetOptions(word: string): Completion[] {
  return snippets()
    .filter((s) => s.prefix.startsWith(word) || s.id.startsWith(word))
    .map((s) => ({
      label: `\\${s.prefix}`,
      detail: s.title,
      type: "snippet",
      boost: -1,
      info: () => {
        const pre = document.createElement("pre");
        pre.className = "cm-snippet-preview";
        pre.textContent = toText(s.body);
        return pre;
      },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        snippet(toTemplate(s.body))(view, null, from, to);
      },
    }));
}

function latexSource(ctx: CompletionContext): CompletionResult | null {
  const env = ctx.matchBefore(/\\begin\{[\w*]*$/);
  if (env) {
    const from = env.from + "\\begin{".length;
    return { from, options: envOptions(), validFor: /^[\w*]*$/ };
  }
  const cmd = ctx.matchBefore(/\\[A-Za-z@]*$/);
  if (!cmd || (cmd.from === cmd.to && !ctx.explicit)) return null;
  const word = cmd.text.slice(1);
  return { from: cmd.from, options: [...commandOptions, ...snippetOptions(word)], validFor: /^\\[A-Za-z@]*$/ };
}

// ── Project index sources ────────────────────────────────────────────────────

const REF = /\\[A-Za-z]*(?:ref|Ref)\*?(?:\[[^\]]*\])?\{([^}]*)$/;
const CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const INPUT = /\\(?:input|include|subfile)\{([^}]*)$/;
const GRAPHIC = /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)$/;
const IMAGE = /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;

function card(rows: string[][]): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-card";
  for (const [k, v] of rows) {
    if (!v) continue;
    const row = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = k;
    row.append(b, document.createTextNode(` ${v}`));
    el.append(row);
  }
  return el;
}

/** Last list item of "a, b, c" typed so far: where the completion starts. */
const itemStart = (ctx: CompletionContext, typed: string): number => {
  const cut = Math.max(typed.lastIndexOf(","), typed.lastIndexOf(" "));
  return ctx.pos - typed.length + cut + 1;
};

function indexSource(ctx: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const snap = activeIndex()?.snap;

  let m = REF.exec(before);
  if (m && snap) {
    return {
      from: itemStart(ctx, m[1]),
      validFor: /^[^,\s}]*$/,
      options: snap.labels.map((l) => ({
        label: l.key,
        type: "constant",
        detail: l.context,
        info: () => card([["etykieta", l.key], ["plik", `${l.file.split(/[\\/]/).pop()}:${l.line}`], ["tekst", l.context]]),
      })),
    };
  }
  m = CITE.exec(before);
  if (m && snap) {
    return {
      from: itemStart(ctx, m[1]),
      validFor: /^[^,\s}]*$/,
      filter: false,
      options: snap.bib
        .filter((b) => `${b.key} ${b.authors} ${b.year} ${b.title}`.toLowerCase().includes(m![1].slice(m![1].lastIndexOf(",") + 1).trim().toLowerCase()))
        .map((b) => ({
          label: b.key,
          type: "text",
          detail: [b.authors.split(";")[0], b.year].filter(Boolean).join(" ") ,
          info: () => card([["autorzy", b.authors], ["rok", b.year], ["tytuł", b.title], ["rodzaj", b.kind]]),
        })),
    };
  }
  const file = INPUT.exec(before) ?? GRAPHIC.exec(before);
  const project = currentProject();
  if (file && project) {
    const images = GRAPHIC.test(before);
    const from = ctx.pos - file[1].length;
    return call<{ path: string; dir: boolean }[]>("fs_files", { pid: project.id })
      .then((es) => {
        const base = project.main?.replace(/[\\/][^\\/]*$/, "") ?? project.roots[0];
        const rel = (p: string) => (p.startsWith(base + "/") ? p.slice(base.length + 1) : p);
        const options: Completion[] = es
          .filter((e) => !e.dir && (images ? IMAGE.test(e.path) : /\.tex$/i.test(e.path)))
          .map((e) => {
            // \input / \include take the name without .tex
            const r = rel(e.path);
            const label = images ? r : r.replace(/\.tex$/i, "");
            return {
              label,
              type: "file",
              info: images && /\.(png|jpe?g|gif|webp|svg)$/i.test(e.path)
                ? () => {
                    const img = document.createElement("img");
                    img.className = "cm-thumb";
                    img.src = protoUrl(`file/${project.id}`, { p: e.path });
                    return img;
                  }
                : undefined,
            };
          });
        return { from, options, validFor: /^[^}]*$/ };
      })
      .catch(() => null);
  }
  return null;
}

/** Tab after a snippet prefix ("fig", "eq*", "-") that stands alone → expand it. */
function expandPrefix(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1 || hasNextSnippetField(state)) return false;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const m = /(?:^|\s)(\S+)$/.exec(before);
  if (!m) return false;
  const word = m[1];
  const s = snippets().find((x) => x.prefix === word);
  if (!s) return false;
  snippet(toTemplate(s.body, { selection: "" }))(view, null, sel.head - word.length, sel.head);
  return true;
}

export function completion(): Extension {
  return [
    autocompletion({ override: [indexSource, latexSource], icons: true, activateOnTyping: true, maxRenderedOptions: 60 }),
    Prec.high(keymap.of([{ key: "Tab", run: expandPrefix }])),
  ];
}
