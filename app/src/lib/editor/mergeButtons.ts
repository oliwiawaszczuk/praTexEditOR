// Per-chunk buttons of the conflict compare view (unified diff against the disk
// version): the editor holds "mine", the deleted lines are the disk version.

import { tip } from "#lib/ui/tooltip.svelte.ts";
import { svgIcon } from "./theme.ts";

export function mergeButton(type: "accept" | "reject", action: (e: MouseEvent) => void): HTMLElement {
  const b = document.createElement("button");
  b.className = `cm-merge-btn ${type}`;
  b.appendChild(svgIcon(type === "accept" ? "check" : "undo", 13));
  // Svelte actions are plain functions: the shared tooltip works on CodeMirror's DOM too.
  tip(b, type === "accept" ? "Zostaw moją wersję" : "Weź wersję z dysku");
  b.onmousedown = action;
  return b;
}
