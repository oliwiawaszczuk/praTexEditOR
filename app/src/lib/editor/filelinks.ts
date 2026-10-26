// ⌘+click (Ctrl) on the path in `\input{content/Wprowadzenie}`, `\include`, `\subfile`,
// `\includegraphics`, `\addbibresource` or `\bibliography{a,b}` opens that file in a tab.
// While ⌘ is held the paths underline and show a hand, as in VS Code. Without ⌘ a click
// just places the cursor; ⌘+click anywhere else still means SyncTeX (setup.ts).

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { currentProject } from "#lib/core/projects.svelte.ts";
import { call } from "#lib/core/tauri.ts";
import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";
import { editor } from "./bridge.svelte.ts";
import { activeIndex } from "#lib/index/index.svelte.ts";

type Kind = "tex" | "image" | "bib";

export interface FileLink {
  kind: Kind;
  /** The path as written. */
  arg: string;
  from: number;
  to: number;
}

const CMD = /\\(input|include|subfile|includegraphics|addbibresource|bibliography)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g;
const IMAGE_EXT = ["", ".png", ".jpg", ".jpeg", ".pdf", ".svg", ".gif", ".webp", ".eps"];

const kindOf = (cmd: string): Kind => (cmd === "includegraphics" ? "image" : cmd === "addbibresource" || cmd === "bibliography" ? "bib" : "tex");

/** Index of the first unescaped `%`, else -1. */
function commentAt(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "%") return i;
  }
  return -1;
}

/** Every path on a line (a `\bibliography{a,b}` gives one per item). */
function linksOnLine(text: string, lineFrom: number): FileLink[] {
  const cut = commentAt(text);
  const code = cut < 0 ? text : text.slice(0, cut);
  const out: FileLink[] = [];
  for (const m of code.matchAll(CMD)) {
    const kind = kindOf(m[1]);
    const start = lineFrom + (m.index ?? 0) + m[0].lastIndexOf("{") + 1;
    let at = 0;
    for (const part of m[2].split(m[1] === "bibliography" ? "," : "\u0000")) {
      const lead = part.length - part.trimStart().length;
      const arg = part.trim();
      if (arg) out.push({ kind, arg, from: start + at + lead, to: start + at + lead + arg.length });
      at += part.length + 1;
    }
  }
  return out;
}

export function fileLinkAt(state: EditorState, pos: number): FileLink | null {
  const line = state.doc.lineAt(pos);
  return linksOnLine(line.text, line.from).find((l) => pos >= l.from && pos <= l.to) ?? null;
}

/** Find the file the path points at (relative to the main file's folder, the current
 * file's folder or a project root; `.tex` / `.bib` / image extensions may be left out). */
async function resolve(link: FileLink, pid: string, current: string | null): Promise<string | null> {
  const project = currentProject();
  if (!project) return null;
  const es = await call<{ path: string; dir: boolean }[]>("fs_files", { pid });
  const files = new Set(es.filter((e) => !e.dir).map((e) => e.path));
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
  const bases = [project.main ? dirOf(project.main) : null, current ? dirOf(current) : null, ...project.roots].filter((b): b is string => !!b);
  const exts = link.kind === "tex" ? ["", ".tex"] : link.kind === "bib" ? ["", ".bib"] : IMAGE_EXT;
  for (const base of bases) {
    for (const ext of exts) {
      const p = `${base}/${link.arg.replace(/^\.\//, "")}${ext}`;
      if (files.has(p)) return p;
    }
  }
  return null;
}

export async function openFileLink(link: FileLink): Promise<void> {
  const project = currentProject();
  const ed = editor();
  if (!project || !ed) return;
  const path = await resolve(link, project.id, ed.cursor()?.path ?? null).catch(() => null);
  if (!path) {
    toast(`Nie znaleziono pliku „${link.arg}”`, { icon: "alert" });
    return;
  }
  showCol("mid");
  await ed.open(path, { focus: true });
}

function marks(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      for (const l of linksOnLine(line.text, line.from)) b.add(l.from, l.to, Decoration.mark({ class: "cm-file-link", attributes: { title: "⌘+klik: otwórz plik" } }));
    }
  }
  return b.finish();
}

export const fileLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    #view: EditorView;
    #key = (e: KeyboardEvent) => this.#view.dom.classList.toggle("cm-cmd", e.metaKey || e.ctrlKey);
    #blur = () => this.#view.dom.classList.remove("cm-cmd");
    constructor(view: EditorView) {
      this.#view = view;
      this.decorations = marks(view);
      window.addEventListener("keydown", this.#key);
      window.addEventListener("keyup", this.#key);
      window.addEventListener("blur", this.#blur);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = marks(u.view);
    }
    destroy(): void {
      window.removeEventListener("keydown", this.#key);
      window.removeEventListener("keyup", this.#key);
      window.removeEventListener("blur", this.#blur);
    }
  },
  { decorations: (p) => p.decorations },
);

// ⌘+click on a custom command (`\arrow`) jumps to its `\newcommand{\arrow}` in any
// project file. Files are read on click only (after saving, so open edits count).

/** Name of the control sequence under `pos` (without the backslash), else null. */
export function macroAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(/\\([A-Za-z@]+)/g)) {
    const from = line.from + (m.index ?? 0);
    if (pos >= from && pos <= from + m[0].length) return m[1];
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Open the definition of `\name`. False = none found (the click then means SyncTeX). */
export async function openMacroDefinition(name: string): Promise<boolean> {
  const project = currentProject();
  const ed = editor();
  if (!project || !ed) return false;
  const def = new RegExp(`\\\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|NewDocumentCommand|RenewDocumentCommand|def|let)\\*?\\s*\\{?\\s*\\\\${escapeRe(name)}(?![A-Za-z@])`);
  try {
    await ed.saveAll();
    const es = await call<{ path: string; dir: boolean }[]>("fs_files", { pid: project.id });
    const files = es.filter((e) => !e.dir && /\.(tex|sty|cls)$/i.test(e.path));
    // The current file first: the nearest definition wins.
    const here = ed.cursor()?.path;
    files.sort((a, b) => Number(b.path === here) - Number(a.path === here));
    for (const f of files) {
      const r = await call<{ kind: string; text?: string }>("fs_read", { pid: project.id, path: f.path, known: null });
      if (r.kind !== "text" || !r.text) continue;
      const lines = r.text.split("\n");
      const i = lines.findIndex((l) => {
        const cut = commentAt(l);
        return def.test(cut < 0 ? l : l.slice(0, cut));
      });
      if (i >= 0) {
        showCol("mid");
        await ed.reveal(f.path, i + 1);
        return true;
      }
    }
  } catch {
    // fall through: no definition found
  }
  return false;
}

// ⌘+click on a key in `\cite{a,b}` / `\ref{x}` jumps to the `@entry` in the .bib or the
// `\label{x}`, from the project index (no file reads).

const REF_CMD = /\\([A-Za-z]*cite[A-Za-z]*|[A-Za-z]*ref|nameref|vref|cref|Cref)\*?(?:\[[^\]]*\])*\{([^{}]*)\}/g;

/** The citation / reference key under `pos`, with what it points at. */
export function refKeyAt(state: EditorState, pos: number): { key: string; kind: "bib" | "label" } | null {
  const line = state.doc.lineAt(pos);
  const cut = commentAt(line.text);
  const code = cut < 0 ? line.text : line.text.slice(0, cut);
  for (const m of code.matchAll(REF_CMD)) {
    const start = line.from + (m.index ?? 0) + m[0].lastIndexOf("{") + 1;
    let at = 0;
    for (const part of m[2].split(",")) {
      const lead = part.length - part.trimStart().length;
      const key = part.trim();
      const from = start + at + lead;
      if (key && pos >= from && pos <= from + key.length) return { key, kind: /cite/i.test(m[1]) ? "bib" : "label" };
      at += part.length + 1;
    }
  }
  return null;
}

/** Open the entry / label. False = the index does not know it (click then means SyncTeX). */
export async function openRefTarget(t: { key: string; kind: "bib" | "label" }): Promise<boolean> {
  const snap = activeIndex()?.snap;
  const hit = t.kind === "bib" ? snap?.bib.find((b) => b.key === t.key) : snap?.labels.find((l) => l.key === t.key);
  const ed = editor();
  if (!hit || !ed) return false;
  showCol("mid");
  await ed.reveal(hit.file, hit.line);
  return true;
}
