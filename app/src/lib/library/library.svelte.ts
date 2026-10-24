// Which of the two pickers is open: the bibliography library (⌘⇧B) or the image gallery.

let open = $state<"bib" | "images" | null>(null);

export const libraryOpen = () => open;
export function openLibrary(kind: "bib" | "images"): boolean {
  open = kind;
  return true;
}
export function closeLibrary(): void {
  open = null;
}
