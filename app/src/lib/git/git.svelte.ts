// Version control state of the open project (Rust: git/). One store per project; it
// refreshes after file changes and when the window regains focus — never on a timer.

import { goTo } from "#lib/core/nav.svelte.ts";
import { currentProject, wsGet, wsSet, type Project } from "#lib/core/projects.svelte.ts";
import { call, on } from "#lib/core/tauri.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
import { confirmAction, showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export type Kind = "added" | "modified" | "deleted" | "renamed" | "typechange";

export interface RepoInfo {
  root: string;
  name: string;
  isRepo: boolean;
  branch: string | null;
  detached: boolean;
  head: string | null;
  changes: number;
  /** Set when the repository lives in a folder above the project folder. */
  repoRoot: string | null;
}
export interface FileSummary {
  path: string;
  oldPath: string | null;
  status: Kind;
  binary: boolean;
  additions: number;
  deletions: number;
}
export interface Line {
  kind: " " | "+" | "-";
  old: number | null;
  new: number | null;
  text: string;
}
export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: Line[];
}
export interface FileDiff extends FileSummary {
  hunks: Hunk[];
  truncated: boolean;
}
export interface Commit {
  id: string;
  short: string;
  summary: string;
  message: string;
  author: string;
  time: number;
  parents: number;
  refs: string[];
}
interface LogPage {
  commits: Commit[];
  more: boolean;
}
export type View = "changes" | "history";
export type Layout = "unified" | "split";

const PAGE = 60;
const FULL = 100_000;

export class GitStore {
  repos = $state<RepoInfo[]>([]);
  loaded = $state(false);
  root = $state<string | null>(null);
  /** Files that differ from the last commit (the "Zmiany" list). */
  changes = $state.raw<FileSummary[]>([]);
  error = $state("");

  view = $state<View>(wsGet<View>("git.view", "changes"));
  layout = $state<Layout>(wsGet<Layout>("git.layout", "unified"));
  fullFile = $state(false);

  // History / comparison.
  commits = $state.raw<Commit[]>([]);
  more = $state(false);
  histPath = $state<string | null>(null);
  /** Selected commit ids: one = its own changes, two = a range (older → newer). */
  picked = $state<string[]>([]);
  /** With one commit: compare it against the working tree instead of its parent. */
  vsWork = $state(false);
  files = $state.raw<FileSummary[]>([]);

  // Selected file and its diff.
  selPath = $state<string | null>(null);
  diff = $state.raw<FileDiff | null>(null);
  diffError = $state("");
  diffLoading = $state(false);

  /** Set by the diff view: jump to the next / previous change. */
  nav: ((dir: 1 | -1) => void) | null = null;

  #project: () => Project;
  #unlisten: Promise<() => void>[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #seq = 0;
  #dead = false;

  constructor(project: () => Project) {
    this.#project = project;
  }

  get pid(): string {
    return this.#project().id;
  }

  // ── derived views of the status ───────────────────────────────────────────
  get repo(): RepoInfo | null {
    return this.repos.find((r) => r.root === this.root) ?? null;
  }
  /** Absolute path → what happened to it (for the file tree). */
  marks = $derived.by(() => {
    const m = new Map<string, Kind>();
    if (!this.root) return m;
    for (const f of this.changes) m.set(this.abs(f.path), f.status);
    return m;
  });
  /** Folders (absolute) that contain a change. */
  dirtyDirs = $derived.by(() => {
    const s = new Set<string>();
    if (!this.root) return s;
    for (const f of this.changes) {
      let i = f.path.lastIndexOf("/");
      while (i > 0) {
        s.add(this.abs(f.path.slice(0, i)));
        i = f.path.lastIndexOf("/", i - 1);
      }
    }
    return s;
  });
  totals = $derived({ add: this.changes.reduce((n, f) => n + f.additions, 0), del: this.changes.reduce((n, f) => n + f.deletions, 0) });
  get dirty(): number {
    return this.changes.length;
  }
  /** Absolute path of a project-relative one, with the separator the system uses. */
  abs(path: string): string {
    const root = this.root ?? "";
    const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    return root + sep + (sep === "/" ? path : path.replaceAll("/", sep));
  }
  /** Project-relative path (with `/`) of an absolute one, or null when it is outside. */
  relOf(abs: string): string | null {
    const a = abs.replaceAll("\\", "/");
    const r = (this.root ?? "").replaceAll("\\", "/");
    return r && a.startsWith(r + "/") ? a.slice(r.length + 1) : null;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  start(): void {
    this.#unlisten.push(
      on<{ pid: string }>("fs-changed", (e) => {
        if (e.pid === this.pid) this.#later(400);
      }),
    );
    // A commit made in a terminal does not touch the files we watch: look again on focus.
    const onFocus = () => this.#later(150);
    window.addEventListener("focus", onFocus);
    this.#unlisten.push(Promise.resolve(() => window.removeEventListener("focus", onFocus)));
    void this.refresh();
  }

  dispose(): void {
    this.#dead = true;
    if (this.#timer) clearTimeout(this.#timer);
    for (const u of this.#unlisten) void u.then((f) => f());
  }

  #later(ms: number): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.refresh(), ms);
  }

  async refresh(): Promise<void> {
    const seq = ++this.#seq;
    try {
      const repos = await call<RepoInfo[]>("git_repos", { pid: this.pid });
      if (this.#dead || seq !== this.#seq) return;
      this.repos = repos;
      this.error = "";
      const saved = wsGet<string | null>("git.root", null);
      if (!this.root || !repos.some((r) => r.root === this.root)) {
        this.root = (repos.find((r) => r.root === saved && r.isRepo) ?? repos.find((r) => r.isRepo) ?? repos[0])?.root ?? null;
      }
      if (this.repo?.isRepo) {
        const changes = await call<FileSummary[]>("git_changes", { pid: this.pid, root: this.root, from: "HEAD", to: "work" });
        if (this.#dead || seq !== this.#seq) return;
        this.changes = changes;
        this.#settleSelection();
        await Promise.all([this.view === "history" ? this.loadHistory(true) : Promise.resolve(), this.#loadList(), this.loadDiff()]);
      } else {
        this.changes = [];
        this.commits = [];
        this.files = [];
        this.diff = null;
      }
    } catch (e) {
      if (!this.#dead) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (!this.#dead) this.loaded = true;
    }
  }

  /** Keep the selection valid after the list changed (file reverted, committed elsewhere…). */
  #settleSelection(): void {
    if (this.view !== "changes" || !this.selPath) return;
    if (!this.changes.some((x) => x.path === this.selPath)) {
      this.selPath = null;
      this.diff = null;
    }
  }

  setRoot(root: string): void {
    this.root = root;
    wsSet("git.root", root);
    this.selPath = null;
    this.diff = null;
    this.picked = [];
    void this.refresh();
  }

  setView(v: View): void {
    if (this.view === v) return;
    this.view = v;
    wsSet("git.view", v);
    this.selPath = null;
    this.diff = null;
    this.files = [];
    if (v === "history") void this.loadHistory(true);
    else this.histPath = null;
  }

  setLayout(l: Layout): void {
    this.layout = l;
    wsSet("git.layout", l);
  }

  toggleFull(): void {
    this.fullFile = !this.fullFile;
    void this.loadDiff();
  }

  // ── what the diff compares ────────────────────────────────────────────────
  /** `from`/`to` for the file list and the diff; null when nothing is chosen. */
  get spec(): { from: string; to: string } | null {
    if (this.view === "changes") return null;
    const byId = (id: string) => this.commits.findIndex((c) => c.id === id);
    if (this.picked.length === 2) {
      const [a, b] = [...this.picked].sort((x, y) => byId(y) - byId(x)); // older first
      return { from: a, to: b };
    }
    const id = this.picked[0];
    if (!id) return null;
    if (this.vsWork) return { from: id, to: "work" };
    const c = this.commits.find((x) => x.id === id);
    return { from: c && c.parents === 0 ? "root" : `${id}^`, to: id };
  }

  /** Spec of the diff for the selected file. */
  #fileSpec(): { from: string; to: string } | null {
    return this.view === "changes" ? { from: "HEAD", to: "work" } : this.spec;
  }

  /** The diff is against the files on disk (line numbers are live). */
  get liveTarget(): boolean {
    return this.#fileSpec()?.to === "work";
  }

  async #loadList(): Promise<void> {
    const s = this.spec;
    if (!s || !this.root) {
      this.files = [];
      return;
    }
    try {
      const list = await call<FileSummary[]>("git_changes", { pid: this.pid, root: this.root, ...s });
      if (this.spec?.from === s.from && this.spec?.to === s.to) this.files = list;
    } catch (e) {
      this.files = [];
      this.diffError = String(e);
    }
  }

  async loadDiff(): Promise<void> {
    const s = this.#fileSpec();
    const path = this.selPath;
    if (!s || !path || !this.root) {
      this.diff = null;
      this.diffError = "";
      return;
    }
    this.diffLoading = true;
    try {
      const d = await call<FileDiff>("git_file_diff", { pid: this.pid, root: this.root, ...s, path, context: this.fullFile ? FULL : 3 });
      if (this.selPath === path) {
        this.diff = d;
        this.diffError = "";
      }
    } catch (e) {
      if (this.selPath === path) {
        this.diff = null;
        this.diffError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      this.diffLoading = false;
    }
  }

  select(path: string): void {
    this.selPath = path;
    void this.loadDiff();
  }

  // ── history ───────────────────────────────────────────────────────────────
  async loadHistory(reset: boolean): Promise<void> {
    if (!this.root) return;
    const skip = reset ? 0 : this.commits.length;
    const limit = reset ? Math.max(PAGE, this.commits.length) : PAGE;
    try {
      const page = await call<LogPage>("git_log", { pid: this.pid, root: this.root, path: this.histPath, skip, limit });
      this.commits = reset ? page.commits : [...this.commits, ...page.commits];
      this.more = page.more;
      this.picked = this.picked.filter((id) => this.commits.some((c) => c.id === id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  setHistPath(path: string | null): void {
    this.histPath = path;
    this.view = "history";
    wsSet("git.view", "history");
    this.picked = [];
    this.files = [];
    this.selPath = null;
    this.diff = null;
    void this.loadHistory(true);
  }

  /** Click = this commit; ⌘/Ctrl/Shift-click = add / drop the second one (range). */
  pick(id: string, additive: boolean): void {
    if (additive && this.picked.length >= 1 && !this.picked.includes(id)) this.picked = [this.picked[0], id];
    else if (additive && this.picked.includes(id) && this.picked.length === 2) this.picked = this.picked.filter((x) => x !== id);
    else this.picked = [id];
    this.vsWork = false;
    this.#afterPick();
  }

  setVsWork(on: boolean): void {
    this.vsWork = on;
    this.#afterPick();
  }

  compareWithWork(id: string): void {
    this.picked = [id];
    this.vsWork = true;
    this.#afterPick();
  }

  clearSecond(): void {
    this.picked = this.picked.slice(0, 1);
    this.#afterPick();
  }

  #afterPick(): void {
    this.selPath = null;
    this.diff = null;
    this.files = [];
    void this.#loadList().then(() => {
      const first = this.files[0];
      if (first) this.select(first.path);
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────
  async #do(cmd: string, args: Record<string, unknown>, ok?: string): Promise<boolean> {
    try {
      await call(cmd, { pid: this.pid, root: this.root, ...args });
      if (ok) toast(ok, { icon: "check" });
      await this.refresh();
      return true;
    } catch (e) {
      void showError("Git", e);
      void this.refresh();
      return false;
    }
  }

  async discard(paths: string[]): Promise<void> {
    const what = paths.length === 1 ? `„${paths[0]}”` : `${paths.length} plików`;
    const ok = await confirmAction("Odrzucić zmiany?", `${paths.length === 1 ? "Plik" : "Pliki"} ${what} wróci do wersji z ostatniego commita (nowe pliki znikną). Obecna zawartość trafi do kosza.`, { confirmText: "Odrzuć", danger: true });
    if (ok) await this.#do("git_discard", { paths }, "Zmiany odrzucone (poprzednia wersja w koszu)");
  }

  async discardHunk(i: number): Promise<void> {
    const ok = await confirmAction("Odrzucić ten fragment?", "Ten fragment wróci do wersji z ostatniego commita. Tej operacji nie można cofnąć.", { confirmText: "Odrzuć", danger: true });
    if (ok) await this.#do("git_discard_hunk", { path: this.selPath, hunk: i });
  }

  async restoreFrom(commit: string, path: string): Promise<void> {
    const ok = await confirmAction("Przywrócić tę wersję pliku?", `„${path}” zostanie zastąpiony wersją z wybranego commita. Obecny plik trafi do kosza.`, { confirmText: "Przywróć", danger: true });
    if (ok) await this.#do("git_restore_from", { commit, path }, "Wersja przywrócona (jako niezatwierdzona zmiana)");
  }

  async init(root: string): Promise<void> {
    if (await this.#do("git_init", { root }, "Repozytorium utworzone")) this.setRoot(root);
  }

  // ── jumping to the editor ─────────────────────────────────────────────────
  async openInEditor(path: string, line?: number): Promise<void> {
    goTo("projekt");
    showCol("mid");
    const ed = editor();
    if (!ed) return toast("Edytor jeszcze się ładuje", { icon: "info" });
    const abs = this.abs(path);
    if (line) await ed.reveal(abs, line);
    else await ed.open(abs);
  }
}

let active = $state.raw<GitStore | null>(null);
export const activeGit = (): GitStore | null => active;

/** Keep the store in step with the open project: call from an effect keyed by its id. */
export function syncGit(id: string | undefined): () => void {
  if (!id) {
    active = null;
    return () => {};
  }
  const store = new GitStore(() => currentProject() as Project);
  active = store;
  store.start();
  return () => {
    store.dispose();
    if (active === store) active = null;
  };
}
