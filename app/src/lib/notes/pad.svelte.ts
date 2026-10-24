// The floating note pad (⌘⇧M) and "send to note" (⌘⇧N): the pinned note and the pad's
// state live in app settings, so both survive a restart.

import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";
import { appendToNote, createNote, flushNote, loadNotes } from "./notes.svelte.ts";

let pinned = $state<string | null>(null);
let open = $state(false);
let restored = false;

/** After app settings are loaded. */
export function restorePad(): void {
  if (restored) return;
  restored = true;
  pinned = getSetting<string | null>("notatki.pinned", null);
  open = !!pinned && getSetting<boolean>("notatki.padOpen", false);
}

export const pinnedNoteId = (): string | null => pinned;
export const padOpen = (): boolean => open;

export function setPinned(id: string | null): void {
  pinned = id;
  setSetting("notatki.pinned", id);
  if (!id) setPadOpen(false);
}

export function setPadOpen(v: boolean): void {
  open = v;
  setSetting("notatki.padOpen", v);
  if (!v) void flushNote();
}

/** ⌘⇧M: show / hide the pad; without a pinned note a fresh one is created and pinned. */
export async function togglePad(): Promise<boolean> {
  if (open) {
    setPadOpen(false);
    return true;
  }
  if (!pinned) {
    const n = await createNote();
    setPinned(n.id);
  }
  setPadOpen(true);
  return true;
}

/** ⌘⇧N: a quoted fragment with its source goes to the end of the pinned note. */
export async function sendToNote(text: string, source: string): Promise<void> {
  const quote = text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const block = `${quote}\n— ${source}\n`;
  if (!pinned) {
    const n = await createNote();
    setPinned(n.id);
  }
  await appendToNote(pinned as string, block);
  toast("Dopisano do notatki", { icon: "note", ms: 1800 });
}
