// Projects (Rust: projects/). One project is open per window; its UI state lives in
// wsGet/wsSet — anything that should survive a restart or differ between projects
// (expanded folders, column widths, open tabs…) goes there, never into localStorage.
// The project view is wrapped in {#key id}, so switching projects rebuilds every
// per-project store from scratch: nothing can leak from the previous project.

import { getSetting, setSetting } from "./appSettings.svelte.ts";
import { debouncedSaver } from "./persisted.ts";
import { call, inTauri } from "./tauri.ts";

export interface Project {
  id: string;
  name: string;
  color: string;
  roots: string[];
  main: string | null;
  createdAt: number;
  openedAt: number;
  /** Same order as roots: false = the folder is missing. */
  rootsOk: boolean[];
}

export interface MainCandidate {
  path: string;
  rel: string;
  preview: string[];
}

export interface TemplateInfo {
  /** The user's own template (can be deleted). */
  custom: boolean;
  /** Main file, relative to the template. */
  main: string;
  id: string;
  name: string;
  icon: string;
  files: string[];
}

/** Project colours: the file-kind palette + accent (never two projects need more). */
export const PROJECT_COLORS = ["#ffc951", "#5b9bd5", "#7bc47f", "#b48ce0", "#f2994a", "#4db6ac", "#f06292", "#90a4ae"];

let list = $state<Project[]>([]);
let current = $state<Project | null>(null);
let cache = $state<Record<string, unknown>>({});

const saver = debouncedSaver(500, () =>
  current ? call("project_state_set", { id: current.id, value: $state.snapshot(cache) }) : Promise.resolve(),
);

export const projects = (): Project[] => list;
export const currentProject = (): Project | null => current;

export function wsGet<T>(key: string, fallback: T): T {
  return key in cache ? (cache[key] as T) : fallback;
}

export function wsSet(key: string, value: unknown): void {
  // Skip no-op writes of primitives; objects are always saved.
  if (typeof value !== "object" && cache[key] === value) return;
  cache[key] = value;
  saver.schedule();
}

export const flushProject = saver.flush;

// Stores of the open project that must finish work before it goes away (the editor
// saves files, writes cursor positions). Run before the project switches, closes or the
// window closes — while wsSet still writes into this project's state.
const leaveHooks = new Set<() => Promise<void>>();

export function onLeaveProject(cb: () => Promise<void>): () => void {
  leaveHooks.add(cb);
  return () => leaveHooks.delete(cb);
}

export async function leaveProject(): Promise<void> {
  await Promise.all([...leaveHooks].map((f) => f().catch((e) => console.error("[project] leave", e))));
}

export async function loadProjects(): Promise<void> {
  if (!inTauri()) return;
  list = await call<Project[]>("projects_list");
}

function replace(p: Project): void {
  list = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list];
  if (current?.id === p.id) current = p;
}

async function setTitle(): Promise<void> {
  if (!inTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(current ? `${current.name} — praTexEditOR` : "praTexEditOR");
}

export async function openProject(id: string): Promise<void> {
  if (current?.id === id) return;
  await leaveProject();
  await saver.flush();
  const p = await call<Project>("project_open", { id });
  cache = await call<Record<string, unknown>>("project_state_get", { id });
  current = p;
  replace(p);
  setSetting("lastProject", id);
  void setTitle();
}

export async function closeProject(): Promise<void> {
  await leaveProject();
  await saver.flush();
  await call("project_close");
  current = null;
  cache = {};
  setSetting("lastProject", null);
  list = await call<Project[]>("projects_list");
  void setTitle();
}

/** Reopen the last project on start (if it still exists). */
export async function restoreLastProject(): Promise<void> {
  const id = getSetting<string | null>("lastProject", null);
  if (id && list.some((p) => p.id === id)) await openProject(id);
}

export async function updateProject(id: string, patch: { name?: string; color?: string; main?: string }): Promise<void> {
  replace(await call<Project>("project_update", { id, ...patch }));
  if (current?.id === id) void setTitle();
}

export async function setRoot(id: string, path: string, replaceRoot?: string): Promise<void> {
  replace(await call<Project>("project_set_root", { id, path, replace: replaceRoot ?? null }));
}

export async function removeRoot(id: string, path: string): Promise<void> {
  replace(await call<Project>("project_remove_root", { id, path }));
}

export async function forgetProject(id: string): Promise<void> {
  if (current?.id === id) {
    await leaveProject();
    await saver.flush();
    current = null;
    cache = {};
    void setTitle();
  }
  await call("project_forget", { id });
  list = list.filter((p) => p.id !== id);
}

export function nextColor(): string {
  const used = new Set(list.map((p) => p.color));
  return PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[list.length % PROJECT_COLORS.length];
}

export const templatesList = (): Promise<TemplateInfo[]> => call<TemplateInfo[]>("templates_list");
export const detectMain = (dir: string): Promise<MainCandidate[]> => call<MainCandidate[]>("detect_main", { dir });

export async function defaultParentDir(): Promise<string> {
  return getSetting<string | null>("lastParentDir", null) ?? (await call<string | null>("default_parent_dir")) ?? "";
}

export async function createFromTemplate(template: string, name: string, parent: string, color: string): Promise<Project> {
  setSetting("lastParentDir", parent);
  const p = await call<Project>("project_from_template", { template, name, parent, color });
  replace(p);
  return p;
}

export async function createFromFolders(name: string, roots: string[], main: string | null, color: string): Promise<Project> {
  const p = await call<Project>("project_create", { name, color, roots, main });
  replace(p);
  return p;
}

export interface Unpacked {
  dir: string;
  files: number;
  candidates: MainCandidate[];
}

export async function unzipProject(zip: string, parent: string, name: string): Promise<Unpacked> {
  setSetting("lastParentDir", parent);
  return call<Unpacked>("project_unzip", { zip, parent, name });
}

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const parentDir = (p: string): string => p.replace(/[\\/][^\\/]*[\\/]?$/, "") || p;
