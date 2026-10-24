// The shortcut window (`?`, help button): every command with its keys, and snippets.

let open = $state<"keys" | "snippets" | null>(null);

export const shortcutsOpen = () => open;
export function openShortcuts(tab: "keys" | "snippets" = "keys"): boolean {
  open = tab;
  return true;
}
export function closeShortcuts(): void {
  open = null;
}
