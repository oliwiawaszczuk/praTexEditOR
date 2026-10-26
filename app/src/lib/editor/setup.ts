// The editor's extension set. One EditorState per open file carries these; preferences
// live in compartments shared by all states, so a change in Ustawienia reconfigures the
// visible file at once and the others when they are next shown.

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec, type Extension, type StateEffect } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { runCommand } from "#lib/core/commands.svelte.ts";
import { isMac } from "#lib/core/keys.ts";
import { language, type LangId } from "./language.ts";
import { colorSwatches } from "./colors.ts";
import { fileLinkAt, fileLinks, macroAt, openFileLink, openMacroDefinition } from "./filelinks.ts";
import { completion } from "./complete.ts";
import { imageHover } from "./hover.ts";
import { flashField } from "./marks.ts";
import { prefs, type Prefs } from "./prefs.ts";
import { insertEnd, latexFolding } from "./structure.ts";
import { editorHighlight, editorTheme, fontSizeTheme, svgIcon } from "./theme.ts";

export const comp = {
  lang: new Compartment(),
  wrap: new Compartment(),
  numbers: new Compartment(),
  font: new Compartment(),
  indent: new Compartment(),
  /** Conflict → compare: the unified merge view against the disk version. */
  merge: new Compartment(),
};

const prefExt = {
  wrap: (p: Prefs) => (p.wrap ? EditorView.lineWrapping : []),
  numbers: (p: Prefs) => (p.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
  font: (p: Prefs) => fontSizeTheme(p.fontSize),
  indent: (p: Prefs) => [indentUnit.of(" ".repeat(p.indent)), EditorState.tabSize.of(p.indent)],
};

export function prefEffects(p: Prefs): StateEffect<unknown>[] {
  return [
    comp.wrap.reconfigure(prefExt.wrap(p)),
    comp.numbers.reconfigure(prefExt.numbers(p)),
    comp.font.reconfigure(prefExt.font(p)),
    comp.indent.reconfigure(prefExt.indent(p)),
  ];
}

/** "\$" stays a literal dollar — no "$$" pair after a backslash. */
const escapedDollar = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "$" || from !== to || from === 0 || view.state.sliceDoc(from - 1, from) !== "\\") return false;
  view.dispatch({ changes: { from, insert: "$" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
  return true;
});

const foldMarkers = foldGutter({
  markerDOM(open) {
    const s = document.createElement("span");
    s.className = open ? "cm-fold-marker" : "cm-fold-marker closed";
    s.appendChild(svgIcon(open ? "chevronDown" : "chevronRight", 11));
    return s;
  },
});

/** ⌘+click (Ctrl on Win/Linux) = show this place in the PDF (SyncTeX); extra cursors
 * move to ⌥+click, as in VS Code. */
const syncClick = [
  EditorView.clickAddsSelectionRange.of((e) => e.altKey),
  EditorView.domEventHandlers({
    mousedown(e, view) {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      // On the path of \input{…} / \includegraphics{…}: open that file instead.
      const link = fileLinkAt(view.state, pos);
      if (link) {
        e.preventDefault();
        void openFileLink(link);
        return true;
      }
      e.preventDefault();
      // On a custom command: jump to its definition; no definition (e.g. \\section) = SyncTeX.
      const macro = macroAt(view.state, pos);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
      if (macro) {
        void openMacroDefinition(macro).then((found) => {
          if (!found) runCommand("sync.toPdf");
        });
        return true;
      }
      runCommand("sync.toPdf");
      return true;
    },
  }),
];

/** ⌘V with an image in the clipboard → image dialog (lib/images). */
const pasteImage = EditorView.domEventHandlers({
  paste(e) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return false;
    e.preventDefault();
    void import("#lib/images/images.svelte.ts").then((m) => m.pasteImage(file));
    return true;
  },
});

export interface Hooks {
  onUpdate: (u: ViewUpdate) => void;
  searchPanel: (view: EditorView) => Panel;
}

export function extensions(lang: LangId, hooks: Hooks): Extension[] {
  const p = prefs();
  return [
    comp.lang.of(language(lang)),
    comp.wrap.of(prefExt.wrap(p)),
    comp.numbers.of(prefExt.numbers(p)),
    comp.font.of(prefExt.font(p)),
    comp.indent.of(prefExt.indent(p)),
    comp.merge.of([]),
    lang === "latex" ? latexFolding : [],
    lintGutter({ hoverTime: 150 }),
    foldMarkers,
    flashField,
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    editorHighlight,
    bracketMatching(),
    closeBrackets(),
    Prec.high(escapedDollar),
    syncClick,
    pasteImage,
    lang === "latex" ? [completion(), imageHover, colorSwatches, fileLinks] : [],
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true, createPanel: hooks.searchPanel }),
    Prec.high(keymap.of([{ key: "Enter", run: insertEnd }])),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    editorTheme,
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", translate: "no" }),
    EditorView.updateListener.of(hooks.onUpdate),
  ];
}
