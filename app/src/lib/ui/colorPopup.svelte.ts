// The color popover (ColorPopupHost) is opened by anyone with a color to change: a
// ColorPicker swatch, or a swatch drawn inside the editor next to `{HTML}{F4F5EF}`.

export interface ColorRequest {
  id: number;
  /** Where the popover hangs (viewport coordinates). */
  anchor: DOMRect;
  value: string;
  /** Live: called while dragging, with "#rrggbb". */
  onchange: (hex: string) => void;
  presets?: string[];
  label?: string;
  /** After the popover closed (focus back to where it came from). */
  onclose?: () => void;
}

let req = $state.raw<ColorRequest | null>(null);
let next = 1;

export const colorRequest = (): ColorRequest | null => req;

export function openColor(r: Omit<ColorRequest, "id">): number {
  const id = next++;
  req = { ...r, id };
  return id;
}

export function closeColor(): void {
  req = null;
}
