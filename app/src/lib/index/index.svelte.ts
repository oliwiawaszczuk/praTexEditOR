// Project index (Rust: index.rs). Created per project by Workspace ({#key}); asks Rust for
// a fresh snapshot after the watcher reports a change to a .tex / .bib file (never on a
// timer). Rust re-reads only files whose mtime/size differ.

import { baseName, type Project } from "#lib/core/projects.svelte.ts";
import { call, on } from "#lib/core/tauri.ts";

export interface OutlineItem {
  level: number;
  title: string;
  file: string;
  line: number;
}

export interface LabelItem {
  key: string;
  file: string;
  line: number;
  context: string;
}

export interface BibItem {
  key: string;
  kind: string;
  authors: string;
  title: string;
  year: string;
  line: number;
  file: string;
}

export interface Snapshot {
  outline: OutlineItem[];
  labels: LabelItem[];
  bib: BibItem[];
  words: number;
  fileWords: Record<string, number>;
}

const EMPTY: Snapshot = { outline: [], labels: [], bib: [], words: 0, fileWords: {} };
const RELEVANT = /\.(tex|bib)$/i;

export class ProjectIndex {
  snap = $state.raw<Snapshot>(EMPTY);
  loaded = $state(false);

  #project: () => Project;
  #unlisten: Promise<() => void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #busy = false;
  #again = false;
  #dead = false;

  constructor(project: () => Project) {
    this.#project = project;
  }

  get pid(): string {
    return this.#project().id;
  }

  start(): void {
    this.#unlisten = on<{ pid: string; paths: string[] }>("fs-changed", (e) => {
      if (e.pid !== this.pid || !e.paths.some((p) => RELEVANT.test(p))) return;
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.refresh(), 400);
    });
    void this.refresh();
  }

  dispose(): void {
    this.#dead = true;
    if (this.#timer) clearTimeout(this.#timer);
    void this.#unlisten?.then((f) => f());
    void call("index_drop", { pid: this.pid }).catch(() => {});
  }

  /** Main file changed (or other reason to re-resolve includes). */
  async refresh(): Promise<void> {
    if (this.#busy) {
      this.#again = true;
      return;
    }
    this.#busy = true;
    try {
      const s = await call<Snapshot>("index_get", { pid: this.pid });
      if (!this.#dead) {
        this.snap = s;
        this.loaded = true;
      }
    } catch {
      // No shell (plain browser) or project gone: keep what we have.
    } finally {
      this.#busy = false;
      if (this.#again && !this.#dead) {
        this.#again = false;
        void this.refresh();
      }
    }
  }

  /** Outline entries as breadcrumb: the chain of ancestors of the section holding `line`. */
  crumbs(file: string, line: number): OutlineItem[] {
    const list = this.snap.outline;
    let at = -1;
    list.forEach((o, i) => {
      if (o.file === file && o.line <= line) at = i;
    });
    if (at < 0) return [];
    const chain: OutlineItem[] = [list[at]];
    for (let i = at - 1, level = list[at].level; i >= 0 && level > 0; i--) {
      if (list[i].level < level) {
        chain.unshift(list[i]);
        level = list[i].level;
      }
    }
    return chain;
  }

  /** Siblings (same level, same parent) of a crumb, for its drop-down. */
  siblings(item: OutlineItem): OutlineItem[] {
    const list = this.snap.outline;
    const i = list.indexOf(item);
    if (i < 0) return [item];
    let from = i;
    while (from > 0 && list[from - 1].level >= item.level) from--;
    let to = i;
    while (to < list.length - 1 && list[to + 1].level >= item.level) to++;
    return list.slice(from, to + 1).filter((o) => o.level === item.level);
  }
}

export const fileLabel = (path: string): string => baseName(path);

// The open project's index, for the palette and completion.
let active = $state.raw<ProjectIndex | null>(null);
export const activeIndex = (): ProjectIndex | null => active;
export function setActiveIndex(i: ProjectIndex | null): void {
  active = i;
}
