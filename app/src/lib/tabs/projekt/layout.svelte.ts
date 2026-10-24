// Three-column layout of the project view (files | editor | PDF), per project.
// Hidden columns collapse to a thin rail; at least one column always stays visible.

import { wsGet, wsSet } from "#lib/core/projects.svelte.ts";

export type Col = "left" | "mid" | "right";
type Hidden = Record<Col, boolean>;

const NONE: Hidden = { left: false, mid: false, right: false };

export const DEFAULT_LEFT = 260;
export const defaultRight = (): number => Math.round(Math.max(360, window.innerWidth * 0.4));
export const MIN = { left: 170, right: 300, mid: 320 };

export const hidden = (): Hidden => wsGet<Hidden>("layout.hidden", NONE);
export const isHidden = (c: Col): boolean => hidden()[c];

export function toggleCol(c: Col): void {
  const h = { ...hidden(), [c]: !hidden()[c] };
  if (h.left && h.mid && h.right) return;
  wsSet("layout.hidden", h);
}

export function showCol(c: Col): void {
  if (isHidden(c)) toggleCol(c);
}

export const leftWidth = (): number => wsGet("layout.left", DEFAULT_LEFT);
export const rightWidth = (): number => wsGet("layout.right", 0) || defaultRight();
export const setLeftWidth = (w: number): void => wsSet("layout.left", Math.round(w));
export const setRightWidth = (w: number): void => wsSet("layout.right", Math.round(w));
