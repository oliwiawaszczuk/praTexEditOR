// Notes (Rust: notes.rs) — global, independent of projects. The list carries title and
// preview; a note's text is fetched when opened and saved debounced (800 ms).

import { call } from "#lib/core/tauri.ts";

export interface NoteMeta {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
}

let list = $state<NoteMeta[]>([]);
let loaded = $state(false);

export const notes = (): NoteMeta[] => list;
export const notesLoaded = (): boolean => loaded;

export async function loadNotes(): Promise<NoteMeta[]> {
  list = await call<NoteMeta[]>("notes_list");
  loaded = true;
  return list;
}

export async function createNote(text = ""): Promise<NoteMeta> {
  const n = await call<NoteMeta>("notes_create", { text });
  await loadNotes();
  return n;
}

export async function deleteNote(id: string): Promise<void> {
  await call("notes_delete", { id });
  delete texts[id];
  await loadNotes();
}

// One shared buffer per note: the Notatki tab and the floating pad edit the same text,
// so neither can show (or save) a stale copy of what the other just typed.
const texts = $state<Record<string, string>>({});

export const noteText = (id: string): string => texts[id] ?? "";

export async function loadNoteText(id: string): Promise<string> {
  if (!(id in texts)) texts[id] = await call<string>("notes_get", { id });
  return texts[id];
}

/** Typing: the buffer changes at once, the file after a pause. */
export function editNote(id: string, text: string): void {
  texts[id] = text;
  scheduleSaveNote(id, text);
}

/** A block (quote + source) at the end of a note; both views see it. */
export async function appendToNote(id: string, block: string): Promise<void> {
  await loadNoteText(id);
  await flushNote();
  texts[id] = await call<string>("notes_append", { id, block });
  await loadNotes();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; text: string } | null = null;

export function scheduleSaveNote(id: string, text: string): void {
  if (pending && pending.id !== id) void flushNote(); // another note: save that one first
  pending = { id, text };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushNote(), 800);
}

export async function flushNote(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  if (!p) return;
  try {
    const title = await call<string>("notes_set", { id: p.id, text: p.text });
    const e = list.find((n) => n.id === p.id);
    if (e) {
      e.updatedAt = Date.now();
      e.preview = p.text.trim().slice(0, 300);
      e.title = title;
    }
  } catch (e) {
    console.error("[notes] save failed", e);
  }
}
