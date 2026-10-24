// Editor preferences (Ustawienia › Edytor). No CodeMirror import: the settings tab
// must not pull the editor chunk.

import { getSetting } from "#lib/core/appSettings.svelte.ts";

export interface Prefs {
  fontSize: number;
  wrap: boolean;
  lineNumbers: boolean;
  indent: number;
}

export const DEFAULT_PREFS: Prefs = { fontSize: 13, wrap: true, lineNumbers: true, indent: 2 };

export function prefs(): Prefs {
  return {
    fontSize: getSetting("editor.fontSize", DEFAULT_PREFS.fontSize),
    wrap: getSetting("editor.wrap", DEFAULT_PREFS.wrap),
    lineNumbers: getSetting("editor.lineNumbers", DEFAULT_PREFS.lineNumbers),
    indent: getSetting("editor.indent", DEFAULT_PREFS.indent),
  };
}
