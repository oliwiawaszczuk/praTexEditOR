// Snippets in force = built-in ones (minus hidden, replaced by the user's version of
// the same id) + the user's own. `<data>/snippets.json`: { items: Snippet[], hidden: id[] }.
// Every snippet is also a command `snippet.insert:<id>` (palette, keys, "Wstaw" bar).

import { call, inTauri } from "#lib/core/tauri.ts";
import { BUILTIN, type Snippet } from "./builtin.ts";
import { parseSnippetFile } from "./vscode.ts";

interface UserFile {
  items: Snippet[];
  hidden: string[];
}

let user = $state<UserFile>({ items: [], hidden: [] });

export const commandId = (id: string): string => `snippet.insert:${id}`;

export async function loadSnippets(): Promise<void> {
  if (!inTauri()) return;
  try {
    const v = await call<Partial<UserFile> | null>("userdata_get", { name: "snippets" });
    user = { items: Array.isArray(v?.items) ? v.items : [], hidden: Array.isArray(v?.hidden) ? v.hidden : [] };
  } catch (e) {
    console.error("[snippets] load", e);
  }
}

async function save(next: UserFile): Promise<void> {
  user = next;
  if (inTauri()) await call("userdata_set", { name: "snippets", value: $state.snapshot(next) });
}

export function snippets(): Snippet[] {
  const own = new Map(user.items.map((s) => [s.id, s]));
  const out: Snippet[] = [];
  for (const b of BUILTIN) {
    if (user.hidden.includes(b.id)) continue;
    out.push(own.get(b.id) ?? b);
    own.delete(b.id);
  }
  return [...out, ...own.values()];
}

export const isBuiltin = (id: string): boolean => BUILTIN.some((b) => b.id === id);
export const isChanged = (id: string): boolean => isBuiltin(id) && user.items.some((s) => s.id === id);
export const builtinOf = (id: string): Snippet | undefined => BUILTIN.find((b) => b.id === id);

export function saveSnippet(s: Snippet): Promise<void> {
  const items = user.items.filter((x) => x.id !== s.id);
  return save({ items: [...items, s], hidden: user.hidden.filter((h) => h !== s.id) });
}

/** Own snippet → gone; built-in → hidden (restorable). */
export function removeSnippet(id: string): Promise<void> {
  return save({
    items: user.items.filter((x) => x.id !== id),
    hidden: isBuiltin(id) && !user.hidden.includes(id) ? [...user.hidden, id] : user.hidden,
  });
}

/** A changed or hidden built-in → back to the original. */
export function resetSnippet(id: string): Promise<void> {
  return save({ items: user.items.filter((x) => x.id !== id), hidden: user.hidden.filter((h) => h !== id) });
}

export const hiddenBuiltins = (): Snippet[] => BUILTIN.filter((b) => user.hidden.includes(b.id));

export function newId(base: string): string {
  const slug = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "snippet";
  const taken = new Set(snippets().map((s) => s.id));
  let id = `u-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `u-${slug}-${n}`;
  return id;
}

/** A VS Code snippets file → own snippets (group "własne"). Returns how many. */
export async function importVsCodeSnippets(json: unknown): Promise<number> {
  const entries = parseSnippetFile(json);
  const items = [...user.items];
  const prefixes = new Set(snippets().map((s) => s.prefix));
  for (const e of entries) {
    const id = newId(e.name);
    let prefix = e.prefix || id.slice(2);
    if (prefixes.has(prefix)) prefix = `${prefix}2`;
    prefixes.add(prefix);
    items.push({ id, title: e.description || e.name, prefix, body: e.body, group: "własne", icon: "snippet" });
  }
  await save({ items, hidden: user.hidden });
  return entries.length;
}
