// Things that are named or done differently per system (Finder / Explorer / file manager).

import { call } from "./tauri.ts";
import { showError } from "#lib/ui/dialogs.svelte.ts";

const ua = (): string => (typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`);

export const isWindows = (): boolean => /Win/i.test(ua());
export const isLinux = (): boolean => !/Mac|iPhone|iPad|Win/i.test(ua());

/** "Pokaż w Finderze" / "…w Eksploratorze" / "…w menedżerze plików". */
export function revealLabel(): string {
  if (/Mac|iPhone|iPad/i.test(ua())) return "Pokaż w Finderze";
  return isWindows() ? "Pokaż w Eksploratorze" : "Pokaż w menedżerze plików";
}

/** Select `path` in the system file manager; failures are shown, never swallowed. */
export function revealInOs(pid: string, path: string): void {
  void call("fs_reveal", { pid, path }).catch((e) => showError(`Nie udało się: ${revealLabel().toLowerCase()}`, e));
}
