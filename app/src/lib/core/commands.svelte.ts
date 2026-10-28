// Command registry — one source of truth for actions, their icons and keys
// (docs/02-plan.md §10). Tooltips, menus, the palette, the shortcut window and the
// shortcut editor all read from here; a component never hard-codes a shortcut.
//
// Keys: VS Code style ("mod+shift+p", chords "mod+k mod+s"). The user's overrides
// (keybindings.json, `setOverrides`) win over the defaults. One window-level key
// handler (capture phase, before CodeMirror) dispatches by context: commands bound to
// the focused part (editor / tree / PDF) first, then global ones.

import { untrack } from "svelte";
import type { IconName } from "#lib/ui/Icon.svelte";

export type When = "global" | "editorFocus" | "treeFocus" | "pdfFocus" | "gitFocus";

export const WHEN_LABEL: Record<When, string> = {
  global: "wszędzie",
  editorFocus: "edytor",
  treeFocus: "drzewo",
  pdfFocus: "PDF",
  gitFocus: "Wersje",
};

export interface Command {
  id: string;
  title: string;
  icon?: IconName;
  /** Default binding, VS Code style: "mod+shift+p", chord "mod+k mod+s". */
  keys?: string;
  /** Where the keys work (default: everywhere). */
  when?: When;
  /** Group in the palette / shortcut window. */
  group?: string;
  /** Extra words the palette searches (besides the title). */
  keywords?: string;
  /** false = not listed in the palette (internal helpers). */
  palette?: boolean;
  /** Return false when the command did not apply (the key then falls through). */
  run: () => boolean | void;
}

const registry = new Map<string, Command>();
let version = $state(0);
/** User bindings: id → keys ("" = no shortcut). */
let overrides = $state<Record<string, string>>({});

/** Register (or replace, e.g. after a project switch) commands; returns the unregister. */
export function register(cmds: Command[]): () => void {
  // untrack: registering from inside an effect must not make it depend on `version`.
  const bump = () => untrack(() => version++);
  for (const c of cmds) registry.set(c.id, c);
  bump();
  return () => {
    for (const c of cmds) if (registry.get(c.id) === c) registry.delete(c.id);
    bump();
  };
}

export const command = (id: string): Command | undefined => registry.get(id);

/** Every command (reactive: re-read when commands come and go). */
export function allCommands(): Command[] {
  void version;
  return [...registry.values()];
}

export function setOverrides(o: Record<string, string>): void {
  overrides = o;
}
export const getOverrides = (): Record<string, string> => overrides;

/** The binding in force: user override, else the default. */
export function keysOf(id: string): string | undefined {
  if (id in overrides) return overrides[id] || undefined;
  return registry.get(id)?.keys;
}

export function runCommand(id: string): boolean {
  const c = registry.get(id);
  return c ? c.run() !== false : false;
}

/** "mod+shift+p" → CodeMirror "Mod-Shift-p". */
export function toCmKey(binding: string): string {
  const NAMES: Record<string, string> = { mod: "Mod", cmd: "Meta", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
  const KEYS: Record<string, string> = { enter: "Enter", escape: "Escape", tab: "Tab", backspace: "Backspace", delete: "Delete", space: "Space", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
  const parts = binding.trim().toLowerCase().split("+");
  const key = parts.pop() ?? "";
  return [...parts.map((p) => NAMES[p] ?? p), KEYS[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : key)].join("-");
}

const NAMED: Record<string, string> = { enter: "Enter", escape: "Escape", tab: "Tab", backspace: "Backspace", delete: "Delete", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
/** e.code for keys whose e.key changes with ⇧/⌥ or the layout. */
const CODES: Record<string, string> = { ",": "Comma", ".": "Period", "/": "Slash", "=": "Equal", "-": "Minus", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "`": "Backquote" };

/** Does a keydown match one stroke ("mod+shift+w")? Letters, digits and punctuation
 * compare `e.code` (⌥ on macOS turns "1" into "¡"), named keys compare `e.key`.
 * A stroke without modifiers that is a printable key ("?") compares `e.key`. */
export function matches(e: KeyboardEvent, binding: string, mac: boolean): boolean {
  const raw = binding.trim().toLowerCase();
  // "shift+/" style and a bare "?" both work; "+" itself is written "plus".
  const parts = raw === "+" ? ["+"] : raw.split("+");
  const key = parts.pop() ?? "";
  const want = new Set(parts.map((p) => (p === "mod" ? (mac ? "cmd" : "ctrl") : p)));
  if (key.length === 1 && !/[a-z0-9]/.test(key) && !(key in CODES) && want.size === 0) {
    // Printable symbol typed as such ("?"): layout-independent by e.key.
    return !e.metaKey && !e.ctrlKey && !e.altKey && e.key === key;
  }
  if (e.metaKey !== want.has("cmd") || e.ctrlKey !== want.has("ctrl") || e.altKey !== want.has("alt") || e.shiftKey !== want.has("shift")) {
    return false;
  }
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return e.code === `Digit${key}`;
  if (key in CODES) return e.code === CODES[key] || e.key === key;
  if (key === "plus") return e.key === "+" || e.code === "Equal";
  return e.key === (NAMED[key] ?? key) || e.key.toLowerCase() === key;
}

/** One keydown → "mod+shift+k" (for recording shortcuts). Null for lone modifiers. */
export function strokeOf(e: KeyboardEvent, mac: boolean): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(e.key)) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (mac && e.ctrlKey) parts.push("ctrl");
  if (!mac && e.metaKey) parts.push("cmd");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else {
    const sym = Object.entries(CODES).find(([, c]) => c === e.code)?.[0];
    const named = Object.entries(NAMED).find(([, k]) => k === e.key)?.[0];
    key = sym ?? named ?? e.key.toLowerCase();
  }
  return [...parts, key].join("+");
}

// ── Dispatch ───────────────────────────────────────────────────────────────────

/** Which part of the window a key event belongs to. */
export function contextOf(target: EventTarget | null): When {
  const el = typeof Element !== "undefined" && target instanceof Element ? target : null;
  if (el?.closest(".cm-content")) return "editorFocus";
  if (el?.closest('[role="tree"]')) return "treeFocus";
  if (el?.closest(".pdfv")) return "pdfFocus";
  if (el?.closest(".git-tab")) return "gitFocus";
  return "global";
}

/** Typing into a field: plain keys ("?", F-keys excepted) must reach it. */
function editable(target: EventTarget | null): boolean {
  const el = typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

let pending: { stroke: string; timer: ReturnType<typeof setTimeout> } | null = null;
let paused = 0;

/** While recording a shortcut nothing may run. */
export function pauseKeys(): () => void {
  paused++;
  return () => void paused--;
}

/** Window keydown (capture phase). `enabled(c)` narrows what may run (e.g. only the
 * open project's view). Returns true when a command took the key. */
export function dispatchKey(e: KeyboardEvent, mac: boolean, enabled: (c: Command) => boolean = () => true): boolean {
  if (paused || e.isComposing) return false;
  const ctx = contextOf(e.target);
  const typing = editable(e.target);
  // Alt (macOS ⌥, Windows AltGr) that types a character — ⌥Z → ż, ⌥S → ś, AltGr+L → ł — is
  // text, never a shortcut: Polish letters must always get through.
  if (e.altKey && !e.metaKey && (typing || ctx === "editorFocus") && e.key.length === 1) {
    const base = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : null;
    if (base !== null && e.key.toLowerCase() !== base && (!e.ctrlKey || e.getModifierState?.("AltGraph"))) return false;
  }
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  const candidates = [...registry.values()]
    .filter((c) => enabled(c) && keysOf(c.id))
    .filter((c) => (c.when ?? "global") === "global" || c.when === ctx)
    // The focused part first, then global.
    .sort((a, b) => Number((b.when ?? "global") === ctx && b.when !== "global") - Number((a.when ?? "global") === ctx && a.when !== "global"));

  if (pending) {
    const first = pending.stroke;
    clearTimeout(pending.timer);
    pending = null;
    for (const c of candidates) {
      const strokes = (keysOf(c.id) as string).split(/\s+/);
      if (strokes.length === 2 && strokes[0] === first && matches(e, strokes[1], mac) && c.run() !== false) {
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
    }
    // Unknown second stroke: swallow it, like VS Code.
    e.preventDefault();
    return true;
  }

  for (const c of candidates) {
    const strokes = (keysOf(c.id) as string).trim().split(/\s+/);
    if (!matches(e, strokes[0], mac)) continue;
    const isPlain = plain && !/^(f\d+|escape)$/.test(strokes[0].toLowerCase());
    if (isPlain && typing) continue;
    if (strokes.length > 1) {
      pending = { stroke: strokes[0], timer: setTimeout(() => (pending = null), 1000) };
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    if (c.run() !== false) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
  }
  return false;
}

/** Other commands already using `keys` where they could clash with a command used in
 * `when` (global clashes with everything). */
export function conflicts(id: string, keys: string, when: When = "global"): Command[] {
  const k = keys.trim().toLowerCase();
  return [...registry.values()].filter((c) => {
    if (c.id === id) return false;
    const other = keysOf(c.id)?.trim().toLowerCase();
    if (!other) return false;
    const w = c.when ?? "global";
    const overlap = w === "global" || when === "global" || w === when;
    // A chord also clashes with a plain binding of its first stroke.
    return overlap && (other === k || other.split(/\s+/)[0] === k || k.split(/\s+/)[0] === other);
  });
}
