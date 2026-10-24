// Built-in snippets (docs/02-plan.md §10.3), VS Code body syntax. In these JS strings
// "\\" is one backslash; a LaTeX line break `\\` is `\\\\` in VS Code syntax, so it is
// written with the BR constant. Leading tabs become the editor's indent unit.

import type { IconName } from "#lib/ui/Icon.svelte";

export type SnippetGroup = "tekst" | "struktura" | "listy" | "matematyka" | "rysunki" | "odwołania" | "beamer" | "własne";

export const GROUPS: { id: SnippetGroup; label: string; icon: IconName }[] = [
  { id: "tekst", label: "Tekst", icon: "bold" },
  { id: "struktura", label: "Struktura", icon: "heading" },
  { id: "listy", label: "Listy", icon: "listBullet" },
  { id: "matematyka", label: "Matematyka", icon: "sigma" },
  { id: "rysunki", label: "Rysunki i tabele", icon: "image" },
  { id: "odwołania", label: "Odwołania", icon: "link" },
  { id: "beamer", label: "Beamer", icon: "slides" },
  { id: "własne", label: "Własne", icon: "snippet" },
];

export interface Snippet {
  id: string;
  title: string;
  /** Typed word + Tab expands it (and `\`-prefixed ones show in completion). */
  prefix: string;
  body: string;
  group: SnippetGroup;
  icon: IconName;
  /** Default shortcut (the user's own lives in keybindings.json like any command). */
  keys?: string;
  /** Shown on the "Wstaw" bar. */
  bar?: boolean;
}

const BR = "\\\\\\\\";
const SEL = "$TM_SELECTED_TEXT";

export const BUILTIN: Snippet[] = [
  // Tekst
  { id: "bold", title: "Pogrubienie", prefix: "bf", body: `\\textbf{\${1:${SEL}}}$0`, group: "tekst", icon: "bold", keys: "mod+b", bar: true },
  { id: "italic", title: "Kursywa", prefix: "it", body: `\\textit{\${1:${SEL}}}$0`, group: "tekst", icon: "italic", keys: "mod+i", bar: true },
  { id: "underline", title: "Podkreślenie", prefix: "ul", body: `\\underline{\${1:${SEL}}}$0`, group: "tekst", icon: "underline", keys: "mod+u", bar: true },
  { id: "emph", title: "Wyróżnienie", prefix: "em", body: `\\emph{\${1:${SEL}}}$0`, group: "tekst", icon: "italic" },
  { id: "texttt", title: "Kod (maszynowe)", prefix: "tt", body: `\\texttt{\${1:${SEL}}}$0`, group: "tekst", icon: "snippet" },
  { id: "textsc", title: "Kapitaliki", prefix: "sc", body: `\\textsc{\${1:${SEL}}}$0`, group: "tekst", icon: "bold" },
  { id: "footnote", title: "Przypis", prefix: "fn", body: `\\footnote{\${1:${SEL}}}$0`, group: "tekst", icon: "note" },
  { id: "quote", title: "Cytat (blok)", prefix: "quo", body: `\\begin{quote}\n\t\${1:${SEL}}\n\\end{quote}\n$0`, group: "tekst", icon: "quote" },
  { id: "href", title: "Link", prefix: "href", body: `\\href{\${1:https://}}{\${2:${SEL}}}$0`, group: "tekst", icon: "link" },
  { id: "url", title: "Adres URL", prefix: "url", body: "\\url{${1:https://}}$0", group: "tekst", icon: "link" },
  { id: "verb", title: "Fragment kodu (verbatim)", prefix: "verb", body: `\\begin{verbatim}\n\${1:${SEL}}\n\\end{verbatim}\n$0`, group: "tekst", icon: "snippet" },

  // Struktura
  { id: "part", title: "Część", prefix: "part", body: "\\part{${1:Tytuł}}\n$0", group: "struktura", icon: "heading" },
  { id: "chapter", title: "Rozdział", prefix: "chap", body: "\\chapter{${1:Tytuł}}\\label{chap:${2}}\n$0", group: "struktura", icon: "heading" },
  { id: "section", title: "Sekcja", prefix: "sec", body: "\\section{${1:Tytuł}}\\label{sec:${2}}\n$0", group: "struktura", icon: "heading", keys: "mod+alt+s" },
  { id: "subsection", title: "Podsekcja", prefix: "sub", body: "\\subsection{${1:Tytuł}}\n$0", group: "struktura", icon: "heading" },
  { id: "subsubsection", title: "Podpodsekcja", prefix: "ssub", body: "\\subsubsection{${1:Tytuł}}\n$0", group: "struktura", icon: "heading" },
  { id: "paragraph", title: "Akapit z tytułem", prefix: "par", body: "\\paragraph{${1:Tytuł}} $0", group: "struktura", icon: "heading" },
  { id: "env", title: "Środowisko", prefix: "beg", body: `\\begin{\${1:nazwa}}\n\t\${2:${SEL}}\n\\end{\${1:nazwa}}\n$0`, group: "struktura", icon: "env" },
  { id: "input", title: "Dołącz plik (\\input)", prefix: "inp", body: "\\input{${1:rozdzialy/}}$0", group: "struktura", icon: "file" },
  { id: "include", title: "Dołącz rozdział (\\include)", prefix: "inc", body: "\\include{${1:rozdzialy/}}$0", group: "struktura", icon: "file" },
  { id: "newcommand", title: "Nowa komenda", prefix: "ncmd", body: "\\newcommand{\\\\${1:nazwa}}[${2:0}]{${3:treść}}$0", group: "struktura", icon: "func" },
  { id: "usepackage", title: "Pakiet", prefix: "pkg", body: "\\usepackage{${1:pakiet}}$0", group: "struktura", icon: "func" },
  {
    id: "document",
    title: "Szkielet dokumentu",
    prefix: "doc",
    body: "\\documentclass[a4paper,11pt]{${1|article,report,book|}}\n\\usepackage{amsmath,graphicx}\n\\usepackage[hidelinks]{hyperref}\n\n\\title{${2:Tytuł}}\n\\author{${3:Autor}}\n\n\\begin{document}\n\\maketitle\n\n$0\n\n\\end{document}\n",
    group: "struktura",
    icon: "tex",
  },

  // Listy
  { id: "itemize", title: "Lista punktowana", prefix: "itm", body: "\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}\n$0", group: "listy", icon: "listBullet", bar: true },
  { id: "enumerate", title: "Lista numerowana", prefix: "enu", body: "\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}\n$0", group: "listy", icon: "listNumber", bar: true },
  { id: "description", title: "Lista opisowa", prefix: "desc", body: "\\begin{description}\n\t\\item[${1:hasło}] ${2}\n\\end{description}\n$0", group: "listy", icon: "listBullet" },
  { id: "item", title: "Punkt listy", prefix: "-", body: "\\item $0", group: "listy", icon: "listBullet" },

  // Matematyka
  { id: "math", title: "Wzór w tekście $…$", prefix: "mk", body: `$\${1:${SEL}}$$0`, group: "matematyka", icon: "sigma", keys: "mod+e", bar: true },
  { id: "displaymath", title: "Wzór wyśrodkowany \\[…\\]", prefix: "dm", body: `\\[\n\t\${1:${SEL}}\n\\]\n$0`, group: "matematyka", icon: "sigma" },
  { id: "equation", title: "Równanie numerowane", prefix: "eq", body: `\\begin{equation}\n\t\${1:${SEL}}\n\t\\label{eq:\${2}}\n\\end{equation}\n$0`, group: "matematyka", icon: "sigma" },
  { id: "equationstar", title: "Równanie bez numeru", prefix: "eq*", body: `\\begin{equation*}\n\t\${1:${SEL}}\n\\end{equation*}\n$0`, group: "matematyka", icon: "sigma" },
  { id: "align", title: "Układ równań (align)", prefix: "ali", body: `\\begin{align}\n\t\${1:a} &= \${2:b} ${BR}\n\t\${3:c} &= \${4:d}\n\\end{align}\n$0`, group: "matematyka", icon: "sigma" },
  { id: "alignstar", title: "Układ równań bez numerów", prefix: "ali*", body: `\\begin{align*}\n\t\${1:a} &= \${2:b} ${BR}\n\t\${3:c} &= \${4:d}\n\\end{align*}\n$0`, group: "matematyka", icon: "sigma" },
  { id: "cases", title: "Przypadki (cases)", prefix: "cas", body: `\\begin{cases}\n\t\${1:x} & \\text{dla } \${2:x > 0} ${BR}\n\t\${3:0} & \\text{w p.p.}\n\\end{cases}$0`, group: "matematyka", icon: "sigma" },
  { id: "pmatrix", title: "Macierz", prefix: "mat", body: `\\begin{pmatrix}\n\t\${1:a} & \${2:b} ${BR}\n\t\${3:c} & \${4:d}\n\\end{pmatrix}$0`, group: "matematyka", icon: "table" },
  { id: "frac", title: "Ułamek", prefix: "frac", body: "\\frac{${1:licznik}}{${2:mianownik}}$0", group: "matematyka", icon: "sigma" },
  { id: "sqrt", title: "Pierwiastek", prefix: "sq", body: "\\sqrt{${1:x}}$0", group: "matematyka", icon: "sigma" },
  { id: "sum", title: "Suma", prefix: "sum", body: "\\sum_{${1:i=1}}^{${2:n}} ${3}$0", group: "matematyka", icon: "sigma" },
  { id: "int", title: "Całka", prefix: "int", body: "\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\,d${4:x}$0", group: "matematyka", icon: "sigma" },
  { id: "lim", title: "Granica", prefix: "lim", body: "\\lim_{${1:n} \\to ${2:\\infty}} ${3}$0", group: "matematyka", icon: "sigma" },
  { id: "leftright", title: "Nawiasy dopasowane", prefix: "lr", body: `\\left( \${1:${SEL}} \\right)$0`, group: "matematyka", icon: "sigma" },
  { id: "text", title: "Tekst we wzorze", prefix: "txt", body: "\\text{${1}}$0", group: "matematyka", icon: "sigma" },
  { id: "mathbb", title: "Zbiór (ℝ, ℕ…)", prefix: "bb", body: "\\mathbb{${1:R}}$0", group: "matematyka", icon: "sigma" },

  // Rysunki i tabele
  {
    id: "figure",
    title: "Rysunek",
    prefix: "fig",
    body: "\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8}\\textwidth]{${3:img/plik}}\n\t\\caption{${4:Podpis}}\n\t\\label{fig:${5}}\n\\end{figure}\n$0",
    group: "rysunki",
    icon: "image",
    keys: "mod+shift+f",
    bar: true,
  },
  { id: "includegraphics", title: "Obraz", prefix: "ig", body: "\\includegraphics[width=${1:0.8}\\textwidth]{${2:img/plik}}$0", group: "rysunki", icon: "image" },
  {
    id: "table",
    title: "Tabela",
    prefix: "tab",
    body: `\\begin{table}[\${1:htbp}]\n\t\\centering\n\t\\caption{\${2:Podpis}}\n\t\\label{tab:\${3}}\n\t\\begin{tabular}{\${4:lcc}}\n\t\t\\hline\n\t\t\${5:A} & \${6:B} & \${7:C} ${BR}\n\t\t\\hline\n\t\t$0 & & ${BR}\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}\n`,
    group: "rysunki",
    icon: "table",
    keys: "mod+shift+t",
    bar: true,
  },
  { id: "tabular", title: "Tabelka (tabular)", prefix: "tbl", body: `\\begin{tabular}{\${1:ll}}\n\t\${2:a} & \${3:b} ${BR}\n\t$0\n\\end{tabular}\n`, group: "rysunki", icon: "table" },
  {
    id: "table33",
    title: "Tabela 3×3 (booktabs)",
    prefix: "tab33",
    body: `\\begin{tabular}{lcc}\n\t\\toprule\n\t\${1:} & \${2:} & \${3:} ${BR}\n\t\\midrule\n\t\${4:} & \${5:} & \${6:} ${BR}\n\t\${7:} & \${8:} & \${9:} ${BR}\n\t\\bottomrule\n\\end{tabular}\n$0`,
    group: "rysunki",
    icon: "table",
  },

  // Odwołania
  { id: "label", title: "Etykieta", prefix: "lbl", body: "\\label{${1:sec:}}$0", group: "odwołania", icon: "link" },
  { id: "ref", title: "Odwołanie", prefix: "ref", body: "\\ref{${1}}$0", group: "odwołania", icon: "link", bar: true },
  { id: "eqref", title: "Odwołanie do wzoru", prefix: "eqref", body: "\\eqref{eq:${1}}$0", group: "odwołania", icon: "link" },
  { id: "pageref", title: "Numer strony", prefix: "pref", body: "\\pageref{${1}}$0", group: "odwołania", icon: "link" },
  { id: "cite", title: "Cytowanie", prefix: "cite", body: "\\cite{${1}}$0", group: "odwołania", icon: "quote", bar: true },
  { id: "bibliography", title: "Bibliografia (BibTeX)", prefix: "bib", body: "\\bibliographystyle{${1:plain}}\n\\bibliography{${2:bibliografia}}\n$0", group: "odwołania", icon: "bib" },

  // Beamer
  { id: "frame", title: "Slajd", prefix: "frm", body: "\\begin{frame}{${1:Tytuł}}\n\t$0\n\\end{frame}\n", group: "beamer", icon: "slides" },
  { id: "columns", title: "Kolumny", prefix: "cols", body: "\\begin{columns}\n\t\\begin{column}{0.5\\textwidth}\n\t\t${1}\n\t\\end{column}\n\t\\begin{column}{0.5\\textwidth}\n\t\t${2}\n\t\\end{column}\n\\end{columns}\n$0", group: "beamer", icon: "layout" },
  { id: "block", title: "Blok", prefix: "blk", body: "\\begin{block}{${1:Tytuł}}\n\t${2}\n\\end{block}\n$0", group: "beamer", icon: "slides" },
  { id: "pause", title: "Pauza", prefix: "pau", body: "\\pause\n$0", group: "beamer", icon: "pause" },
];

/** Section level commands for the "H" menu of the bar. */
export const HEADINGS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];
/** Math entries of the "Σ" menu. */
export const MATHS = ["math", "displaymath", "equation", "align", "frac", "sum", "int", "pmatrix"];
