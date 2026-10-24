// One context menu for the whole app: openMenu(event, items). Items are pictogram +
// label + shortcut, like everywhere else.

import type { IconName } from "./Icon.svelte";

export interface MenuItem {
  icon: IconName;
  label: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}
export type MenuEntry = MenuItem | "sep";

let state = $state<{ x: number; y: number; items: MenuEntry[] } | null>(null);

export const currentMenu = () => state;

export function openMenu(e: MouseEvent | { clientX: number; clientY: number }, items: MenuEntry[]): void {
  if ("preventDefault" in e) e.preventDefault();
  state = { x: e.clientX, y: e.clientY, items };
}

export function closeMenu(): void {
  state = null;
}
