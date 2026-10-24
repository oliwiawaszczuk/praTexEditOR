// One shared tooltip for the whole app: `use:tip={{ label, keys }}` on any element.
// Every pictogram gets one (docs/03-ux.md §1: name + current shortcut).

import type { Action } from "svelte/action";
import { formatKeys } from "#lib/core/keys.ts";

export interface TipSpec {
  label: string;
  /** Binding string, e.g. "mod+b" — shown formatted for the platform. */
  keys?: string;
}

interface Shown {
  label: string;
  keys: string;
  rect: DOMRect;
}

const DELAY_MS = 400;
let shown = $state<Shown | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export const currentTip = (): Shown | null => shown;

function hide(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  shown = null;
}

export const tip: Action<HTMLElement, TipSpec | string> = (node, initial) => {
  let spec: TipSpec = typeof initial === "string" ? { label: initial } : initial;
  node.setAttribute("aria-label", spec.label);

  const enter = () => {
    if (timer) clearTimeout(timer);
    // Already showing a tip (moving along a toolbar) → switch instantly.
    const delay = shown ? 0 : DELAY_MS;
    timer = setTimeout(() => {
      if (!node.isConnected) return;
      shown = { label: spec.label, keys: spec.keys ? formatKeys(spec.keys) : "", rect: node.getBoundingClientRect() };
    }, delay);
  };

  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("pointerdown", hide);
  return {
    update(next) {
      spec = typeof next === "string" ? { label: next } : next;
      node.setAttribute("aria-label", spec.label);
    },
    destroy() {
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", hide);
      node.removeEventListener("pointerdown", hide);
      hide();
    },
  };
};
