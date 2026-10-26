// Symbol palette state: open/closed + anchor. The popover itself is SymbolPalette.svelte.

let state = $state<{ x: number; y: number } | null>(null);

export const symbolPalette = () => state;
export const closeSymbols = () => void (state = null);

/** Open under `el`, or in the top-right corner of the editor when no anchor is given. */
export function toggleSymbols(el?: Element | null): void {
  if (state) return closeSymbols();
  const r = (el ?? document.querySelector(".cm-editor"))?.getBoundingClientRect();
  if (!r) return;
  state = el ? { x: r.left, y: r.bottom + 4 } : { x: Math.max(8, r.right - 360), y: r.top + 8 };
}
