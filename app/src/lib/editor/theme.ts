// Editor look: only var(--…) tokens from tokens.css (docs/design/ui-tokens.md).

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { iconPath, type IconName } from "#lib/ui/Icon.svelte";
import { T } from "./language.ts";

export const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--editor-bg)", color: "var(--text)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.65" },
    ".cm-content": { caretColor: "var(--accent)", padding: "10px 0 40vh", WebkitUserSelect: "text", userSelect: "text" },
    ".cm-line": { padding: "0 18px 0 6px" },
    ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--accent)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--editor-selection)" },
    ".cm-activeLine": { backgroundColor: "var(--editor-line-active)" },
    ".cm-gutters": { backgroundColor: "var(--editor-bg)", color: "var(--editor-gutter)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 14px", minWidth: "36px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-dim-1)" },
    ".cm-foldGutter .cm-gutterElement": { display: "flex", alignItems: "center", padding: "0 2px", color: "var(--text-dim-4)", cursor: "pointer" },
    ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--accent)" },
    ".cm-fold-marker": { display: "flex", opacity: "0", transition: "opacity var(--t-fast)" },
    ".cm-gutters:hover .cm-fold-marker, .cm-fold-marker.closed": { opacity: "1" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--accent-a10)",
      border: "1px solid var(--accent-a30)",
      color: "var(--accent)",
      borderRadius: "4px",
      padding: "0 6px",
      margin: "0 4px",
    },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--syn-bracket-match)", outline: "none" },
    "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "var(--danger-a15)", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "var(--editor-match)", outline: "1px solid var(--accent-a30)", borderRadius: "2px" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-a40)" },
    ".cm-selectionMatch": { backgroundColor: "var(--hover)", outline: "1px solid var(--line-3)", borderRadius: "2px" },
    ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--text)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line-2)" },
    ".cm-tooltip": { backgroundColor: "var(--bg-panel)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)" },
    ".cm-specialChar": { color: "var(--danger)" },
    // Compile diagnostics (lint): gutter dots, wavy underline, hover card.
    ".cm-gutter-lint": { width: "12px" },
    ".cm-gutter-lint .cm-gutterElement": { padding: "0", display: "flex", alignItems: "center", justifyContent: "center" },
    ".cm-lint-marker": { width: "7px", height: "7px", borderRadius: "50%", content: "none" },
    ".cm-lint-marker-error": { background: "var(--danger)", boxShadow: "0 0 6px var(--danger-a40)" },
    ".cm-lint-marker-warning": { background: "var(--accent)" },
    ".cm-lint-marker-info": { background: "var(--text-dim-4)" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--danger)", textUnderlineOffset: "3px" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--accent-a70)", textUnderlineOffset: "3px" },
    ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted var(--text-dim-4)", textUnderlineOffset: "3px" },
    ".cm-tooltip-lint, .cm-tooltip-hover": { padding: "0", overflow: "hidden" },
    ".cm-diagnostic": { padding: "7px 12px", borderLeft: "3px solid transparent", fontSize: "var(--fs-sm)", maxWidth: "520px", whiteSpace: "normal" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--accent)" },
    ".cm-diagnostic-info": { borderLeftColor: "var(--text-dim-4)" },
    // Completion list: pictogram per kind (ƒ command, ▢ environment, » snippet).
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font)", maxHeight: "16em" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 10px 2px 4px", lineHeight: "1.6" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--accent-a15)", color: "var(--text)" },
    ".cm-completionIcon": { width: "1.4em", opacity: "1", textAlign: "center", fontSize: "90%" },
    ".cm-completionIcon-function:after": { content: "'ƒ'", color: "var(--syn-command)" },
    ".cm-completionIcon-env:after": { content: "'▢'", color: "var(--syn-env)" },
    ".cm-completionIcon-snippet:after": { content: "'»'", color: "var(--accent)" },
    ".cm-completionDetail": { marginLeft: "10px", fontStyle: "normal", color: "var(--text-dim-3)" },
    ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent)", fontWeight: "600" },
    ".cm-completionInfo": { padding: "0", maxWidth: "420px" },
    ".cm-snippet-preview": { margin: "0", padding: "8px 10px", fontFamily: "var(--font)", fontSize: "var(--fs-sm)", color: "var(--text-dim-1)", whiteSpace: "pre-wrap" },
    // Index completions: bibliography / label cards and image thumbnails.
    ".cm-card": { padding: "8px 10px", fontSize: "var(--fs-sm)", color: "var(--text-dim-1)", lineHeight: "1.5", maxWidth: "380px" },
    ".cm-card b": { color: "var(--text-dim-3)", fontWeight: "500" },
    ".cm-thumb": { display: "block", maxWidth: "240px", maxHeight: "180px", margin: "6px", borderRadius: "4px" },
    // Paths of \input{…}: underlined with a hand while ⌘ is held (⌘+click opens the file).
    ".cm-cmd .cm-file-link": { textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
    ".cm-cmd .cm-file-link:hover": { color: "var(--accent)" },
    // Color swatch next to `{HTML}{F4F5EF}` (click = color picker).
    ".cm-color-swatch": { display: "inline-block", width: "11px", height: "11px", margin: "0 4px 0 1px", verticalAlign: "-1px", borderRadius: "3px", background: "var(--c)", border: "1px solid var(--line-3)", cursor: "pointer", transition: "transform var(--t-fast), border-color var(--t-fast)" },
    ".cm-color-swatch:hover": { transform: "scale(1.25)", borderColor: "var(--accent)" },
    // Active snippet fields: accent frame; Tab / ⇧Tab move, Esc ends.
    ".cm-snippetField": { backgroundColor: "var(--accent-a10)", outline: "1px solid var(--accent-a40)", borderRadius: "2px" },
    ".cm-pratex-hint": { marginTop: "3px", color: "var(--text-dim-2)" },
    ".cm-pratex-flash": { animation: "cm-pratex-flash 1.2s ease-out" },
    "@keyframes cm-pratex-flash": { from: { backgroundColor: "var(--accent-a30)" }, to: { backgroundColor: "transparent" } },
    // Merge view (conflict → compare).
    ".cm-changedLine, .cm-insertedLine": { backgroundColor: "var(--diff-ins) !important" },
    ".cm-changedText": { background: "var(--diff-ins-strong) !important" },
    ".cm-deletedChunk": { backgroundColor: "var(--diff-del) !important" },
    ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": { background: "var(--diff-del-strong) !important", textDecoration: "none" },
    ".cm-changeGutter": { width: "3px", paddingLeft: "0" },
    ".cm-changedLineGutter": { background: "var(--ok)" },
    ".cm-deletedLineGutter": { background: "var(--danger)" },
    ".cm-chunkButtons": { position: "absolute", insetInlineEnd: "12px", display: "flex", gap: "4px", zIndex: "2" },
    ".cm-merge-btn": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "22px",
      height: "20px",
      padding: "0",
      background: "var(--bg-panel)",
      border: "1px solid var(--line-3)",
      borderRadius: "4px",
      color: "var(--text-dim-1)",
      cursor: "pointer",
    },
    ".cm-merge-btn.accept:hover": { color: "var(--ok)", borderColor: "var(--ok)" },
    ".cm-merge-btn.reject:hover": { color: "var(--accent)", borderColor: "var(--accent-a40)" },
  },
  { dark: true },
);

export const fontSizeTheme = (px: number) => EditorView.theme({ "&": { fontSize: `${px}px` } });

const highlight = HighlightStyle.define([
  { tag: T.command, color: "var(--syn-command)" },
  { tag: T.env, color: "var(--syn-env)" },
  { tag: T.heading, color: "var(--syn-section)", fontWeight: "600" },
  { tag: T.key, color: "var(--syn-key)" },
  { tag: T.path, color: "var(--syn-path)" },
  { tag: T.math, color: "var(--syn-math)" },
  { tag: T.mathDelim, color: "var(--syn-math)", fontWeight: "600" },
  { tag: T.verbatim, color: "var(--syn-verbatim)" },
  { tag: T.bibType, color: "var(--syn-env)", fontWeight: "600" },
  { tag: T.bibField, color: "var(--syn-command)" },
  { tag: tags.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.bracket, color: "var(--text-dim-1)" },
]);

export const editorHighlight = syntaxHighlighting(highlight);

/** An inline SVG icon for DOM that CodeMirror owns (gutters, widgets). */
export function svgIcon(name: IconName, size = 12): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(k, String(v));
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", iconPath(name));
  svg.appendChild(path);
  return svg;
}
