// File tree of the open project: lazy folder listings (only expanded folders are read),
// a flat row list for the virtual renderer, selection, inline create/rename, and file
// operations with undo. Created by FileTree for one project ({#key} in the view).

import { updateRefs } from "#lib/index/refs.ts";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { getSetting } from "#lib/core/appSettings.svelte.ts";
import { baseName, parentDir, updateProject, wsGet, wsSet, type Project } from "#lib/core/projects.svelte.ts";
import { call, on } from "#lib/core/tauri.ts";
import { revealInOs } from "#lib/core/os.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { chooseOption, showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface Row {
  key: string;
  path: string;
  name: string;
  dir: boolean;
  depth: number;
  /** Index of the project folder for root rows. */
  root?: number;
  missing?: boolean;
  /** Inline input row for a new file / folder. */
  input?: "file" | "folder";
  /** Folder a drop on this row goes to. */
  dropDir: string;
}

interface Transfer {
  done: [string, string][];
  conflicts: string[];
  skipped: string[];
}

type Editing = { mode: "create"; dir: string; folder: boolean } | { mode: "rename"; path: string } | null;

const sep = (p: string): string => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
const join = (dir: string, name: string): string => `${dir.replace(/[\\/]$/, "")}${sep(dir)}${name}`;
const isUnder = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + "/") || p.startsWith(dir + "\\");

export class TreeStore {
  readonly children = new SvelteMap<string, Entry[]>();
  readonly expanded: SvelteSet<string>;
  readonly selected = new SvelteSet<string>();
  readonly missing = new SvelteSet<string>();
  anchor = $state<string | null>(null);
  focused = $state<string | null>(null);
  editing = $state<Editing>(null);
  filter = $state("");
  results = $state<Entry[] | null>(null);
  /** Path just created/moved in → briefly highlighted. */
  flash = $state<string | null>(null);

  readonly rows: Row[] = $derived.by(() => this.flatten());

  #project: () => Project;
  #unsub: Promise<() => void> | null = null;

  constructor(project: () => Project) {
    this.#project = project;
    const saved = wsGet<string[] | null>("tree.expanded", null);
    // First open: all project folders expanded.
    this.expanded = new SvelteSet(saved ?? project().roots);
  }

  get project(): Project {
    return this.#project();
  }

  get vis(): { hidden: boolean; aux: boolean } {
    return { hidden: getSetting("tree.showHidden", false), aux: getSetting("tree.showAux", false) };
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.#unsub = on<{ pid: string; dirs: string[] }>("fs-changed", (e) => {
      if (e.pid === this.project.id) void this.refresh(e.dirs);
    });
    const p = this.project;
    await Promise.all(
      [...this.expanded].map((d) => (p.roots.some((r) => isUnder(d, r)) ? this.load(d) : this.expanded.delete(d))),
    );
  }

  stop(): void {
    void this.#unsub?.then((f) => f());
  }

  async load(dir: string): Promise<void> {
    try {
      const list = await call<Entry[]>("fs_list", { pid: this.project.id, dir, vis: this.vis });
      this.children.set(dir, list);
      this.missing.delete(dir);
    } catch {
      this.children.delete(dir);
      if (this.project.roots.includes(dir)) this.missing.add(dir);
      else this.expanded.delete(dir);
    }
  }

  /** Re-read every loaded folder (visibility settings changed). */
  async reloadAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((d) => this.load(d)));
  }

  /** Watcher: re-read only folders we have loaded. */
  async refresh(dirs: string[]): Promise<void> {
    const todo = new Set<string>();
    for (const d of dirs) if (this.children.has(d)) todo.add(d);
    // A root that reappeared (disk plugged back in).
    for (const r of this.project.roots) if (this.missing.has(r) && dirs.some((d) => isUnder(d, r))) todo.add(r);
    await Promise.all([...todo].map((d) => this.load(d)));
    if (this.filter) void this.search(this.filter);
  }

  // ── Expand / collapse ──────────────────────────────────────────────────────

  #saveExpanded(): void {
    wsSet("tree.expanded", [...this.expanded]);
  }

  async expand(dir: string): Promise<void> {
    if (!this.expanded.has(dir)) {
      this.expanded.add(dir);
      this.#saveExpanded();
    }
    if (!this.children.has(dir)) await this.load(dir);
  }

  collapse(dir: string): void {
    if (this.expanded.delete(dir)) this.#saveExpanded();
  }

  toggle(dir: string): void {
    if (this.expanded.has(dir)) this.collapse(dir);
    else void this.expand(dir);
  }

  collapseAll(): void {
    this.expanded.clear();
    this.#saveExpanded();
  }

  /** Expand all ancestors of `path` (inside its root) and select it. */
  async reveal(path: string): Promise<void> {
    const root = this.project.roots.find((r) => isUnder(path, r));
    if (!root) return;
    let d = parentDir(path);
    const chain: string[] = [];
    while (d.length >= root.length && isUnder(d, root)) {
      chain.unshift(d);
      if (d === root) break;
      d = parentDir(d);
    }
    for (const c of chain) await this.expand(c);
    this.select(path);
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  flatten(): Row[] {
    const rows: Row[] = [];
    const p = this.project;
    const edit = this.editing;
    const walk = (dir: string, depth: number) => {
      if (edit?.mode === "create" && edit.dir === dir) {
        rows.push({ key: "@input", path: join(dir, ""), name: "", dir: edit.folder, depth, input: edit.folder ? "folder" : "file", dropDir: dir });
      }
      for (const e of this.children.get(dir) ?? []) {
        rows.push({ key: e.path, path: e.path, name: e.name, dir: e.dir, depth, dropDir: e.dir ? e.path : dir });
        if (e.dir && this.expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    p.roots.forEach((r, i) => {
      const missing = this.missing.has(r) || p.rootsOk[i] === false;
      rows.push({ key: r, path: r, name: baseName(r), dir: true, depth: 0, root: i, missing, dropDir: r });
      if (!missing && this.expanded.has(r)) walk(r, 1);
    });
    return rows;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(path: string, mode: "single" | "toggle" | "range" = "single"): void {
    if (mode === "toggle") {
      if (!this.selected.delete(path)) this.selected.add(path);
      this.anchor = path;
    } else if (mode === "range" && this.anchor) {
      const keys = this.rows.map((r) => r.path);
      const [a, b] = [keys.indexOf(this.anchor), keys.indexOf(path)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) {
        this.selected.clear();
        for (const k of keys.slice(a, b + 1)) this.selected.add(k);
      }
    } else {
      this.selected.clear();
      this.selected.add(path);
      this.anchor = path;
    }
    this.focused = path;
  }

  /** What a gesture on `path` acts on: the selection if it contains it, else just it. */
  targets(path: string): string[] {
    return this.selected.has(path) ? [...this.selected] : [path];
  }

  isRoot(path: string): boolean {
    return this.project.roots.includes(path);
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  #flash(path: string): void {
    this.flash = path;
    setTimeout(() => {
      if (this.flash === path) this.flash = null;
    }, 900);
  }

  async startCreate(dir: string, folder: boolean): Promise<void> {
    await this.expand(dir);
    this.editing = { mode: "create", dir, folder };
  }

  startRename(path: string): void {
    if (this.isRoot(path)) return;
    this.editing = { mode: "rename", path };
  }

  cancelEdit(): void {
    this.editing = null;
  }

  async commitEdit(name: string): Promise<void> {
    const e = this.editing;
    this.editing = null;
    name = name.trim();
    if (!e || !name) return;
    try {
      if (e.mode === "create") {
        const path = await call<string>("fs_create", { pid: this.project.id, dir: e.dir, name, folder: e.folder });
        await this.load(e.dir);
        this.select(path);
        this.#flash(path);
      } else {
        if (name === baseName(e.path)) return;
        const to = await call<string>("fs_rename", { pid: this.project.id, path: e.path, name });
        await this.load(parentDir(e.path));
        this.select(to);
        await this.#fixMain([[e.path, to]]);
        toast(`Zmieniono nazwę: ${name}`, {
          icon: "undo",
          action: () => void this.#undoRename(to, baseName(e.path)),
        });
      }
    } catch (err) {
      void showError(e.mode === "create" ? "Nie udało się utworzyć" : "Nie udało się zmienić nazwy", err);
    }
  }

  async #undoRename(path: string, oldName: string): Promise<void> {
    try {
      const back = await call<string>("fs_rename", { pid: this.project.id, path, name: oldName });
      await this.load(parentDir(path));
      await this.#fixMain([[path, back]]);
      this.select(back);
    } catch (err) {
      void showError("Nie udało się cofnąć", err);
    }
  }

  /** Something moved or was renamed → open tabs and the main file follow it. */
  async #fixMain(moves: [string, string][]): Promise<void> {
    editor()?.moved(moves);
    const main = this.project.main;
    if (main) {
      for (const [from, to] of moves) {
        if (isUnder(main, from)) {
          await updateProject(this.project.id, { main: to + main.slice(from.length) });
          break;
        }
      }
    }
    void updateRefs(this.project.id, moves);
  }

  /** Move (or copy) into `target`. Name clashes → one question for the whole batch. */
  async transfer(sources: string[], target: string, copy: boolean): Promise<void> {
    sources = sources.filter((s) => s !== target && !(isUnder(target, s) && !copy));
    if (!copy) sources = sources.filter((s) => parentDir(s) !== target);
    if (!sources.length) return;
    const pid = this.project.id;
    try {
      let r = await call<Transfer>("fs_transfer", { pid, sources, target, copy, policy: "ask" });
      if (r.conflicts.length) {
        const names = r.conflicts.map(baseName);
        const policy = await chooseOption(
          names.length === 1 ? `„${names[0]}” już jest w tym folderze` : `${names.length} plików już jest w tym folderze`,
          names.length > 1 ? names.slice(0, 6).join(", ") + (names.length > 6 ? "…" : "") : "",
          [
            { value: "keepBoth", label: "Zachowaj oba", icon: "duplicate" },
            { value: "replace", label: "Zastąp", icon: "refresh", danger: true },
            { value: "skip", label: "Pomiń", icon: "close" },
          ],
        );
        if (!policy) return;
        r = await call<Transfer>("fs_transfer", { pid, sources, target, copy, policy });
      }
      if (!this.expanded.has(target)) {
        this.expanded.add(target);
        this.#saveExpanded();
      }
      await Promise.all([...new Set([target, ...sources.map(parentDir)])].map((d) => this.load(d)));
      if (!copy) await this.#fixMain(r.done);
      if (r.done.length) {
        this.selected.clear();
        for (const [, to] of r.done) this.selected.add(to);
        this.#flash(r.done[0][1]);
        const n = r.done.length;
        const what = n === 1 ? `„${baseName(r.done[0][1])}”` : `${n} elementy`;
        toast(`${copy ? "Skopiowano" : "Przeniesiono"} ${what}`, {
          icon: "undo",
          action: () => void this.#undoTransfer(r.done, copy),
        });
      }
    } catch (err) {
      void showError(copy ? "Nie udało się skopiować" : "Nie udało się przenieść", err);
    }
  }

  async #undoTransfer(done: [string, string][], copy: boolean): Promise<void> {
    const pid = this.project.id;
    try {
      if (copy) {
        await call("fs_trash", { pid, paths: done.map(([, to]) => to) });
      } else {
        // Back to each original folder (grouped), names as they are now.
        const byDir = new Map<string, string[]>();
        for (const [from, to] of done) byDir.set(parentDir(from), [...(byDir.get(parentDir(from)) ?? []), to]);
        for (const [dir, items] of byDir) await call("fs_transfer", { pid, sources: items, target: dir, copy: false, policy: "keepBoth" });
        await this.#fixMain(done.map(([from, to]) => [to, from]));
      }
      await this.refresh([...new Set(done.flatMap(([a, b]) => [parentDir(a), parentDir(b)]))]);
    } catch (err) {
      void showError("Nie udało się cofnąć", err);
    }
  }

  /** Files dropped from Finder (or pasted paths): always a copy. */
  copyIn(paths: string[], target: string): Promise<void> {
    return this.transfer(paths, target, true);
  }

  async trash(paths: string[]): Promise<void> {
    paths = paths.filter((p) => !this.isRoot(p));
    if (!paths.length) return;
    try {
      await call("fs_trash", { pid: this.project.id, paths });
      for (const p of paths) this.selected.delete(p);
      await this.refresh([...new Set(paths.map(parentDir))]);
      toast(paths.length === 1 ? `„${baseName(paths[0])}” w koszu` : `${paths.length} elementy w koszu`, { icon: "trash" });
    } catch (err) {
      void showError("Nie udało się przenieść do kosza", err);
    }
  }

  async duplicate(path: string): Promise<void> {
    try {
      const to = await call<string>("fs_duplicate", { pid: this.project.id, path });
      await this.load(parentDir(path));
      this.select(to);
      this.#flash(to);
    } catch (err) {
      void showError("Nie udało się zduplikować", err);
    }
  }

  revealInOs(path: string): void {
    revealInOs(this.project.id, path);
  }

  /** Path as `\input`/`\includegraphics` want it: relative to the main file's folder. */
  relPath(path: string): string {
    const p = this.project;
    const base = p.main ? parentDir(p.main) : (p.roots.find((r) => isUnder(path, r)) ?? "");
    const a = base.split(/[\\/]/).filter(Boolean);
    const b = path.split(/[\\/]/).filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
  }

  async setMain(path: string): Promise<void> {
    await updateProject(this.project.id, { main: path });
    toast(`Plik główny: ${baseName(path)}`, { icon: "star" });
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  async search(q: string): Promise<void> {
    this.filter = q;
    if (!q.trim()) {
      this.results = null;
      return;
    }
    const r = await call<Entry[]>("fs_search", { pid: this.project.id, query: q.trim(), vis: this.vis });
    if (this.filter === q) this.results = r;
  }
}

let active: TreeStore | null = null;

/** The tree of the open project (for drops routed from the window). */
export const activeTree = (): TreeStore | null => active;
export function setActiveTree(t: TreeStore | null): void {
  active = t;
}
