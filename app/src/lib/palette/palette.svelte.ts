// One window for quick open (⌘P, files) and the command palette (⌘⇧P, prefix ">"),
// switched by the first character, as in VS Code (docs/03-ux.md §8).

let open = $state(false);
let query = $state("");

export const paletteOpen = (): boolean => open;
export const paletteQuery = (): string => query;

export function openPalette(prefix: string): boolean {
  query = prefix;
  open = true;
  return true;
}

export function setPaletteQuery(q: string): void {
  query = q;
}

export function closePalette(): void {
  open = false;
}
