// Symbol palette data: LaTeX command → group. `text` symbols work outside math mode too
// (the rest is wrapped in `$…$` when the cursor is in running text). `pkg` = package needed.

export interface Sym {
  cmd: string;
  /** Search words (PL + EN) beside the command name. */
  q?: string;
  text?: boolean;
  pkg?: string;
}

export interface SymGroup {
  id: string;
  title: string;
  /** Preview glyph of the tab. */
  glyph: string;
  items: Sym[];
}

const s = (cmd: string, q?: string, extra: Partial<Sym> = {}): Sym => ({ cmd, q, ...extra });

export const SYMBOLS: SymGroup[] = [
  {
    id: "greek",
    title: "Greckie",
    glyph: "\\alpha",
    items: [
      ...["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega"].map((c) => s(`\\${c}`, c)),
      ...["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"].map((c) => s(`\\${c}`, c)),
    ],
  },
  {
    id: "ops",
    title: "Operatory",
    glyph: "\\sum",
    items: [
      s("\\pm", "plus minus"), s("\\mp", "minus plus"), s("\\times", "razy mnożenie"), s("\\div", "dzielenie"), s("\\cdot", "kropka mnożenie"),
      s("\\ast", "gwiazdka"), s("\\star"), s("\\circ", "kółko złożenie"), s("\\bullet", "punkt"), s("\\oplus", "suma prosta"), s("\\otimes", "iloczyn tensorowy"),
      s("\\sum", "suma"), s("\\prod", "iloczyn"), s("\\int", "całka integral"), s("\\iint", "całka podwójna"), s("\\oint", "całka krzywoliniowa"),
      s("\\partial", "pochodna cząstkowa"), s("\\nabla", "nabla gradient"), s("\\sqrt{}", "pierwiastek"), s("\\infty", "nieskończoność"),
      s("\\lim", "granica"), s("\\max"), s("\\min"), s("\\sup"), s("\\inf"), s("\\log"), s("\\ln"), s("\\exp"), s("\\sin"), s("\\cos"), s("\\tan"), s("\\det"),
    ],
  },
  {
    id: "rel",
    title: "Relacje",
    glyph: "\\leq",
    items: [
      s("\\leq", "mniejsze równe"), s("\\geq", "większe równe"), s("\\neq", "różne"), s("\\approx", "w przybliżeniu"), s("\\equiv", "tożsame"), s("\\sim", "podobne"),
      s("\\simeq"), s("\\cong", "przystające"), s("\\propto", "proporcjonalne"), s("\\ll", "dużo mniejsze"), s("\\gg", "dużo większe"), s("\\prec"), s("\\succ"),
      s("\\parallel", "równoległe"), s("\\perp", "prostopadłe"), s("\\mid", "dzieli"), s("\\nmid"), s("\\doteq"), s("\\asymp"),
    ],
  },
  {
    id: "arrows",
    title: "Strzałki",
    glyph: "\\rightarrow",
    items: [
      s("\\rightarrow", "strzałka w prawo to"), s("\\leftarrow", "w lewo"), s("\\leftrightarrow", "w obie"), s("\\Rightarrow", "implikacja"), s("\\Leftarrow"),
      s("\\Leftrightarrow", "równoważność wtedy i tylko wtedy"), s("\\mapsto", "przekształca"), s("\\longrightarrow"), s("\\longleftarrow"), s("\\longmapsto"),
      s("\\uparrow", "w górę"), s("\\downarrow", "w dół"), s("\\updownarrow"), s("\\nearrow"), s("\\searrow"), s("\\nwarrow"), s("\\swarrow"),
      s("\\rightleftharpoons", "równowaga reakcja chemia"), s("\\leftrightharpoons"), s("\\hookrightarrow"), s("\\rightsquigarrow"), s("\\to"), s("\\gets"),
    ],
  },
  {
    id: "sets",
    title: "Zbiory i logika",
    glyph: "\\in",
    items: [
      s("\\in", "należy"), s("\\notin", "nie należy"), s("\\ni"), s("\\subset", "podzbiór"), s("\\subseteq"), s("\\supset"), s("\\supseteq"), s("\\cup", "suma zbiorów"),
      s("\\cap", "przecięcie"), s("\\setminus", "różnica zbiorów"), s("\\emptyset", "zbiór pusty"), s("\\varnothing"), s("\\forall", "dla każdego"), s("\\exists", "istnieje"),
      s("\\nexists"), s("\\neg", "negacja"), s("\\land", "i"), s("\\lor", "lub"), s("\\vdash"), s("\\models"), s("\\top"), s("\\bot"),
      s("\\mathbb{R}", "liczby rzeczywiste", { pkg: "amssymb" }), s("\\mathbb{N}", "naturalne", { pkg: "amssymb" }), s("\\mathbb{Z}", "całkowite", { pkg: "amssymb" }),
      s("\\mathbb{Q}", "wymierne", { pkg: "amssymb" }), s("\\mathbb{C}", "zespolone", { pkg: "amssymb" }),
    ],
  },
  {
    id: "misc",
    title: "Różne",
    glyph: "\\ldots",
    items: [
      s("\\ldots", "wielokropek"), s("\\cdots"), s("\\vdots"), s("\\ddots"), s("\\prime", "prim"), s("\\hbar", "h kreślone"), s("\\ell"), s("\\Re"), s("\\Im"),
      s("\\aleph"), s("\\angle", "kąt"), s("\\triangle", "trójkąt"), s("\\square", "kwadrat", { pkg: "amssymb" }), s("\\therefore", "zatem", { pkg: "amssymb" }),
      s("\\because", "ponieważ", { pkg: "amssymb" }), s("\\checkmark", "ptaszek", { pkg: "amssymb" }), s("\\degree", "stopień", { pkg: "gensymb" }),
      s("\\hat{}", "daszek"), s("\\bar{}", "kreska nadkreślenie"), s("\\vec{}", "wektor"), s("\\dot{}", "kropka pochodna"), s("\\tilde{}", "tylda"),
      s("\\overline{}", "nadkreślenie"), s("\\underline{}"), s("\\frac{}{}", "ułamek"), s("\\binom{}{}", "dwumian", { pkg: "amsmath" }),
    ],
  },
  {
    id: "text",
    title: "Tekst",
    glyph: "§",
    items: [
      s("\\S", "paragraf", { text: true }), s("\\P", "akapit", { text: true }), s("\\dag", "krzyżyk", { text: true }), s("\\ddag", undefined, { text: true }),
      s("\\copyright", "prawa autorskie", { text: true }), s("\\textregistered", "zastrzeżony", { text: true }), s("\\texttrademark", "znak towarowy", { text: true }),
      s("\\textbullet", "punktor", { text: true }), s("\\textdegree", "stopień", { text: true }), s("\\textmu", "mikro", { text: true, pkg: "textcomp" }),
      s("\\textendash", "półpauza", { text: true }), s("\\textemdash", "pauza", { text: true }), s("\\ldots", "wielokropek", { text: true }),
      s("\\euro", "euro", { text: true, pkg: "eurosym" }), s("\\pounds", "funt", { text: true }), s("\\textless", "mniejsze", { text: true }), s("\\textgreater", "większe", { text: true }),
      s("\\&", "ampersand", { text: true }), s("\\%", "procent", { text: true }), s("\\$", "dolar", { text: true }), s("\\#", "hash", { text: true }), s("\\_", "podkreślnik", { text: true }),
      s("\\{", "klamra", { text: true }), s("\\}", "klamra", { text: true }), s("\\textbackslash", "backslash", { text: true }),
    ],
  },
];

/** Rough "is it plain text" test used by the search too. */
export function search(q: string): Sym[] {
  const w = q.trim().toLowerCase().replace(/^\\/, "");
  if (!w) return [];
  const out: Sym[] = [];
  const seen = new Set<string>();
  for (const g of SYMBOLS) {
    for (const it of g.items) {
      if (seen.has(it.cmd)) continue;
      if (it.cmd.toLowerCase().includes(w) || it.q?.toLowerCase().includes(w)) {
        seen.add(it.cmd);
        out.push(it);
      }
    }
  }
  return out;
}
