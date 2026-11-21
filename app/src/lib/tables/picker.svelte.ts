// Table generator state: open/closed + anchor. The popover itself is TablePicker.svelte.

let state = $state<{ x: number; y: number } | null>(null);

export const tablePicker = () => state;
export const closeTable = () => void (state = null);

/** Open under `el`, or in the top-right corner of the editor when no anchor is given. */
export function toggleTable(el?: Element | null): void {
  if (state) return closeTable();
  const r = (el ?? document.querySelector(".cm-editor"))?.getBoundingClientRect();
  if (!r) return;
  state = el ? { x: r.left, y: r.bottom + 4 } : { x: Math.max(8, r.right - 280), y: r.top + 8 };
}
