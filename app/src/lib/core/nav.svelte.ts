// Which top-level tab is shown, and cross-tab jumps (engine chip → Ustawienia › O aplikacji).

import { getSetting, setSetting } from "./appSettings.svelte.ts";

export type TabKey = "projekt" | "tablica" | "notatki" | "ustawienia";
export type SettingsSection = "ogolne" | "edytor" | "kompilacja" | "pdf" | "skroty" | "snippety" | "szablony" | "projekty" | "info";

const TABS: TabKey[] = ["projekt", "tablica", "notatki", "ustawienia"];

let tab = $state<TabKey>("projekt");
let section = $state<SettingsSection>("info");

export const activeTab = (): TabKey => tab;
export const settingsSection = (): SettingsSection => section;

/** After app settings are loaded. */
export function restoreNav(): void {
  const t = getSetting<TabKey>("activeTab", "projekt");
  tab = TABS.includes(t) ? t : "projekt";
  section = getSetting<SettingsSection>("settingsSection", "info");
}

export function goTo(t: TabKey, s?: SettingsSection): void {
  tab = t;
  setSetting("activeTab", t);
  if (s) openSection(s);
}

export function openSection(s: SettingsSection): void {
  section = s;
  setSetting("settingsSection", s);
}
