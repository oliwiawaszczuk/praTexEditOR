// Compilation of the open project (Rust: engine/build.rs). Created per project by
// Workspace ({#key}). Saves come back from the watcher as `fs-changed` like any change
// made outside, so one path covers both: a short pause after the last change, then one
// request — Rust coalesces requests that arrive while a build runs.
//
// With system TeX the pause starts a *live* pass (one bare engine run, no bibliography);
// the full build (latexmk: biber, reruns) follows once typing has stopped for a moment.
// ⌘S / ⌘Enter, the first build and engine changes are always full.

import { getSetting } from "#lib/core/appSettings.svelte.ts";
import { register } from "#lib/core/commands.svelte.ts";
import { baseName, wsGet, wsSet, type Project } from "#lib/core/projects.svelte.ts";
import { call, on } from "#lib/core/tauri.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export type Severity = "error" | "warning" | "box";

export interface Diagnostic {
  severity: Severity;
  file: string | null;
  line: number | null;
  message: string;
  hint: string | null;
}

export type EngineId = "tectonic" | "pdflatex" | "xelatex" | "lualatex";

export const ENGINES: { id: EngineId; label: string }[] = [
  { id: "tectonic", label: "Tectonic" },
  { id: "pdflatex", label: "pdfLaTeX" },
  { id: "xelatex", label: "XeLaTeX" },
  { id: "lualatex", label: "LuaLaTeX" },
];

export interface BuildResult {
  pid: string;
  /** mtime of the published PDF (0 = none yet): the viewer reloads when it changes. */
  rev: number;
  fresh: boolean;
  ok: boolean;
  cancelled: boolean;
  durationMs: number;
  engine: EngineId;
  diagnostics: Diagnostic[];
  message: string | null;
}

interface Progress {
  pid: string;
  phase: "running" | "waiting" | "downloading";
  downloads: number;
  detail: string;
}

/** idle · pending (asked, not started yet) · running · waiting (engine warm-up) · downloading */
export type Phase = "idle" | "pending" | Progress["phase"];

export type Filters = Record<Severity, boolean>;
const DEFAULT_FILTERS: Filters = { error: true, warning: true, box: false };

/** TeX by-products and the exported PDF never trigger a build (no loops). */
const IGNORED = /\.(aux|log|synctex\.gz|synctex|fdb_latexmk|fls|out|toc|lof|lot|bbl|blg|nav|snm|vrb|xdv|run\.xml|bcf)$|(^|[\\/])\.DS_Store$|[\\/]\.git([\\/]|$)/i;

const isUnder = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + "/") || p.startsWith(dir + "\\");

export class Build {
  phase = $state<Phase>("idle");
  downloads = $state(0);
  detail = $state("");
  last = $state.raw<BuildResult | null>(null);
  /** build_state answered (until then the column shows nothing rather than "no PDF"). */
  loaded = $state(false);
  readonly busy: boolean = $derived(this.phase !== "idle");
  readonly counts = $derived(count(this.last?.diagnostics ?? []));
  readonly filters: Filters = $derived(wsGet<Filters>("build.filters", DEFAULT_FILTERS));
  /** What the drawer lists and the editor marks. */
  readonly visible: Diagnostic[] = $derived((this.last?.diagnostics ?? []).filter((d) => this.filters[d.severity]));
  /** Project files with errors (red dot in the tree). */
  readonly errorFiles: Set<string> = $derived(new Set((this.last?.diagnostics ?? []).filter((d) => d.severity === "error" && d.file).map((d) => d.file as string)));

  #project: () => Project;
  #offs: (() => void)[] = [];
  #unlisten: Promise<() => void>[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #fullTimer: ReturnType<typeof setTimeout> | null = null;
  /** Our own ⌘S saves, already compiled: their watcher echo is skipped. */
  #echo = new Set<string>();
  #echoUntil = 0;
  #cursor = -1;

  constructor(project: () => Project) {
    this.#project = project;
    this.#offs.push(
      register([
        { id: "build.compile", title: "Zapisz i kompiluj", icon: "play", keys: "mod+s", run: () => void this.compileNow() },
        { id: "build.compileEditor", title: "Zapisz i kompiluj", icon: "play", keys: "mod+enter", when: "editorFocus", run: () => void this.compileNow() },
        { id: "build.cancel", title: "Przerwij kompilację", icon: "close", keys: "mod+.", run: () => (this.busy ? void this.cancel() : false) },
        { id: "build.toggleAuto", title: "Auto-kompilacja", icon: "refresh", run: () => this.setAuto(!this.auto) },
        { id: "build.nextError", title: "Następny błąd", icon: "chevronDown", keys: "f8", run: () => this.step(1) },
        { id: "build.prevError", title: "Poprzedni błąd", icon: "chevronUp", keys: "shift+f8", run: () => this.step(-1) },
      ]),
    );
  }

  get pid(): string {
    return this.#project().id;
  }

  get auto(): boolean {
    return wsGet<boolean | null>("build.auto", null) ?? getSetting("build.auto", true);
  }

  setAuto(v: boolean): void {
    wsSet("build.auto", v);
    if (v) this.request();
  }

  /** Per-project engine, else the default from Ustawienia › Kompilacja. */
  get engine(): EngineId {
    return wsGet<EngineId | null>("build.engine", null) ?? getSetting<EngineId>("build.engine", "tectonic");
  }

  get engineOverride(): EngineId | null {
    return wsGet<EngineId | null>("build.engine", null);
  }

  setEngine(e: EngineId | null): void {
    wsSet("build.engine", e);
    this.request();
  }

  setFilter(s: Severity, on: boolean): void {
    wsSet("build.filters", { ...this.filters, [s]: on });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Subscribe first, then ask: nothing emitted in between is lost.
    this.#unlisten.push(
      on<Progress>("build-progress", (p) => {
        if (p.pid !== this.pid) return;
        this.phase = p.phase;
        this.downloads = p.downloads;
        this.detail = p.detail;
      }),
      on<BuildResult>("build-done", (r) => {
        if (r.pid === this.pid) this.#done(r);
      }),
      on<{ pid: string; paths: string[] }>("fs-changed", (e) => {
        if (e.pid === this.pid) this.#onDisk(e.paths);
      }),
    );
    try {
      const s = await call<{ running: boolean; last: BuildResult | null }>("build_state", { pid: this.pid });
      if (s.last && !this.last) this.last = s.last;
      if (s.running) this.phase = "running";
    } catch {
      // No shell (plain browser) or no project: nothing to show yet.
    }
    this.loaded = true;
    // Files may have changed while the app was closed: one build on open.
    if (this.auto && this.phase === "idle" && this.#project().main) this.request();
  }

  dispose(): void {
    for (const f of this.#offs) f();
    for (const u of this.#unlisten) void u.then((f) => f());
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#fullTimer) clearTimeout(this.#fullTimer);
  }

  /** Typing preview on (Ustawienia › Kompilacja) and an engine that can do a bare pass. */
  get live(): boolean {
    return this.engine !== "tectonic" && getSetting("build.live", true);
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  request(mode: "full" | "live" = "full"): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (mode === "full" && this.#fullTimer) {
      clearTimeout(this.#fullTimer);
      this.#fullTimer = null;
    }
    if (!this.#project().main) {
      this.#done({ pid: this.pid, rev: this.last?.rev ?? 0, fresh: false, ok: false, cancelled: false, durationMs: 0, engine: this.engine, diagnostics: [], message: "Projekt nie ma pliku głównego — wskaż go w drzewie (menu pliku → ★)" });
      return;
    }
    if (this.phase === "idle") this.phase = "pending";
    call("build_request", { pid: this.pid, opts: { engine: this.engine, copyPdf: getSetting("build.copyPdf", false), live: mode === "live" } }).catch((e) => {
      this.phase = "idle";
      toast(String(e instanceof Error ? e.message : e), { icon: "alert", error: true });
    });
  }

  /** ⌘S / ⌘Enter: save every open file, compile at once (also with auto off). */
  async compileNow(): Promise<void> {
    const saved = (await editor()?.saveAll()) ?? [];
    for (const p of saved) this.#echo.add(p);
    this.#echoUntil = performance.now() + 1500;
    this.request();
  }

  async cancel(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await call("build_cancel", { pid: this.pid }).catch(() => {});
  }

  #onDisk(paths: string[]): void {
    const now = performance.now();
    if (now > this.#echoUntil) this.#echo.clear();
    const main = this.#project().main;
    const exported = main ? main.replace(/\.[^./\\]+$/, ".pdf") : null;
    const relevant = paths.filter((p) => {
      if (this.#echo.delete(p)) return false;
      return !IGNORED.test(p) && p !== exported && this.#project().roots.some((r) => isUnder(p, r));
    });
    if (!relevant.length || !this.auto) return;
    if (this.#timer) clearTimeout(this.#timer);
    if (!this.live) {
      this.#timer = setTimeout(() => this.request(), getSetting("build.delayMs", 200));
      return;
    }
    this.#timer = setTimeout(() => this.request("live"), getSetting("build.delayMs", 200));
    // The full build waits for a real pause in typing.
    if (this.#fullTimer) clearTimeout(this.#fullTimer);
    this.#fullTimer = setTimeout(() => {
      this.#fullTimer = null;
      this.request();
    }, getSetting("build.fullMs", 2000));
  }

  #done(r: BuildResult): void {
    this.phase = "idle";
    this.downloads = 0;
    this.detail = "";
    if (r.cancelled) return;
    this.last = r;
    this.#cursor = -1;
    if (r.message) toast(r.message, { icon: "alert", error: true, ms: 6000 });
  }

  // ── Errors ─────────────────────────────────────────────────────────────────

  /** F8 / ⇧F8: next / previous diagnostic that has a place in a file. */
  step(dir: 1 | -1): boolean {
    const list = this.visible.filter((d) => d.file && d.line);
    if (!list.length) return false;
    this.#cursor = (this.#cursor + dir + list.length) % list.length;
    if (this.#cursor < 0) this.#cursor += list.length;
    void this.reveal(list[this.#cursor]);
    return true;
  }

  async reveal(d: Diagnostic): Promise<void> {
    if (!d.file) return;
    const at = this.visible.filter((x) => x.file && x.line).indexOf(d);
    if (at >= 0) this.#cursor = at;
    showCol("mid");
    await editor()?.reveal(d.file, d.line ?? 1);
  }
}

export function count(ds: Diagnostic[]): Record<Severity, number> {
  const c = { error: 0, warning: 0, box: 0 };
  for (const d of ds) c[d.severity]++;
  return c;
}

/** "rozdzialy/01-wstep.tex" relative to the folder of the main file (else the name). */
export function relName(file: string, project: Project): string {
  const base = project.main ? project.main.replace(/[\\/][^\\/]*$/, "") : null;
  if (base && isUnder(file, base)) return file.slice(base.length + 1);
  return baseName(file);
}

// The open project's build, for the tree (red dots) and the PDF column.
let active = $state.raw<Build | null>(null);
export const activeBuild = (): Build | null => active;
export function setActiveBuild(b: Build | null): void {
  active = b;
}
