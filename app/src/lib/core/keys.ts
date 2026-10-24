// Shortcut display. Bindings are written VS Code style ("mod+shift+p"); `mod` is ⌘ on
// macOS and Ctrl elsewhere. The keymap engine (E5) parses the same strings.

export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MAC: Record<string, string> = { mod: "⌘", cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const PC: Record<string, string> = { mod: "Ctrl", cmd: "Win", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
const NAMED: Record<string, string> = {
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  space: "Space",
  tab: "Tab",
};

/** "mod+shift+p" → "⌘⇧P" (mac) / "Ctrl+Shift+P"; chords "mod+k mod+s" → "⌘K ⌘S". */
export function formatKeys(binding: string, mac = isMac()): string {
  return binding
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      const parts = stroke.toLowerCase().split("+");
      const names = parts.map((p, i) => {
        if (i < parts.length - 1) return (mac ? MAC : PC)[p] ?? p;
        return NAMED[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1));
      });
      return mac ? names.join("") : names.join("+");
    })
    .join(" ");
}
