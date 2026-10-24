// Open files of the project (editor tabs). One EditorState per file: switching tabs is
// view.setState(), so undo history, selection and scroll survive without re-parsing.
// Autosave after a pause; changes from outside (watcher) are merged in with a minimal
// diff when the tab is clean, or raise a conflict bar when it is not.
// Created once per project by Workspace ({#key}); the EditorView attaches/detaches
// (the middle column can be hidden while the files stay open).

import { EditorSelection, EditorState, Transaction, type Text } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { toggleComment, undo as undoCmd } from "@codemirror/commands";
import { openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import { toTemplate } from "#lib/snippets/vscode.ts";
import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
import { register } from "#lib/core/commands.svelte.ts";
import { baseName, onLeaveProject, wsGet, wsSet, type Project } from "#lib/core/projects.svelte.ts";
import { call, on } from "#lib/core/tauri.ts";
import { chooseOption } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";
import { fileKind } from "#lib/tree/kinds.ts";
import { langFor, language } from "./language.ts";
import type { BridgeDiagnostic, EditorBridge } from "./bridge.svelte.ts";
import { diagnosticsSpec, revealLine } from "./marks.ts";
import { openReplace, searchPanel } from "./searchPanel.ts";
import { prefs } from "./prefs.ts";
import { comp, extensions, prefEffects } from "./setup.ts";

export interface Stamp {
  mtime: number;
  size: number;
}

type ReadResult =
  | { kind: "text"; text: string; crlf: boolean; bom: boolean; stamp: Stamp }
  | { kind: "unchanged" }
  | { kind: "binary" | "tooBig" | "encoding"; size: number }
  | { kind: "missing" };

/** What the middle column shows for a tab. */
export type DocKind = "loading" | "text" | "binary" | "tooBig" | "encoding" | "missing" | "error";

interface Pos {
  anchor: number;
  head: number;
  top: number;
}

/** Marks our own programmatic edits (disk → editor) so they do not count as typing. */
const external = Transaction.userEvent.of("external");

const isUnder = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + "/") || p.startsWith(dir + "\\");

export class Doc {
  path = $state("");
  preview = $state(false);
  kind = $state<DocKind>("loading");
  dirty = $state(false);
  /** Deleted (or moved away) outside the app; the text stays until the tab is closed. */
  gone = $state(false);
  /** Disk version that clashes with unsaved edits. */
  conflict = $state<string | null>(null);
  comparing = $state(false);
  size = $state(0);
  error = $state("");
  readonly name: string = $derived(baseName(this.path));

  // Heavy, non-reactive parts.
  state: EditorState | null = null;
  saved: Text | null = null;
  stamp: Stamp | null = null;
  crlf = false;
  bom = false;
  scroll: ReturnType<EditorView["scrollSnapshot"]> | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  saving: Promise<void> | null = null;
  loading: Promise<void> | null = null;

  constructor(path: string, preview: boolean) {
    this.path = path;
    this.preview = preview;
  }
}

export class Docs implements EditorBridge {
  docs = $state<Doc[]>([]);
  activePath = $state<string | null>(null);
  readonly active: Doc | null = $derived(this.docs.find((d) => d.path === this.activePath) ?? null);

  view: EditorView | null = null;
  /** The doc whose state is in the view right now. */
  #inView: Doc | null = null;
  #project: () => Project;
  #offs: (() => void)[] = [];
  #unlisten: Promise<() => void> | null = null;
  #posTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last compile diagnostics by file (applied to states as they load or show). */
  #diags = new Map<string, BridgeDiagnostic[]>();

  constructor(project: () => Project) {
    this.#project = project;
    this.#offs.push(
      register([
        // ⌘S is "save + compile" (build.compile); this one only saves.
        { id: "editor.save", title: "Zapisz", icon: "disk", group: "Edytor", run: () => void this.saveAll() },
        { id: "tab.close", title: "Zamknij kartę", icon: "close", keys: "mod+w", group: "Karty", run: () => (this.activePath ? void this.close(this.activePath) : false) },
        { id: "tab.next", title: "Następna karta", keys: "ctrl+tab", group: "Karty", run: () => this.cycle(1) },
        { id: "tab.prev", title: "Poprzednia karta", keys: "ctrl+shift+tab", group: "Karty", run: () => this.cycle(-1) },
        { id: "editor.replace", title: "Zamień", icon: "replace", keys: "mod+alt+f", when: "editorFocus", group: "Edytor", run: () => (this.view ? void openReplace(this.view) : false) },
        { id: "editor.toggleWrap", title: "Zawijanie wierszy", icon: "wrap", keys: "alt+z", when: "editorFocus", group: "Edytor", run: () => this.toggleWrap() },
        { id: "editor.find", title: "Szukaj w pliku", icon: "search", keys: "mod+f", when: "editorFocus", group: "Edytor", run: () => (this.view ? openSearchPanel(this.view) : false) },
        { id: "editor.comment", title: "Zakomentuj / odkomentuj", icon: "snippet", keys: "mod+/", when: "editorFocus", group: "Edytor", run: () => (this.view ? toggleComment(this.view) : false) },
        { id: "editor.selectNext", title: "Zaznacz następne wystąpienie", icon: "selection", keys: "mod+d", when: "editorFocus", group: "Edytor", run: () => (this.view ? selectNextOccurrence(this.view) : false) },
        { id: "editor.toggleInsertBar", title: "Pasek „Wstaw”", icon: "layout", keys: "mod+shift+i", group: "Edytor", run: () => void setSetting("editor.insertBar", !getSetting("editor.insertBar", true)) },
      ]),
      onLeaveProject(() => this.flush()),
    );
  }

  get pid(): string {
    return this.#project().id;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.#unlisten = on<{ pid: string; paths: string[] }>("fs-changed", (e) => {
      if (e.pid === this.pid) void this.#onDisk(e.paths);
    });
    const saved = wsGet<{ path: string; preview?: boolean }[]>("editor.tabs", []);
    const roots = this.#project().roots;
    this.docs = saved.filter((t) => roots.some((r) => isUnder(t.path, r))).map((t) => new Doc(t.path, !!t.preview));
    const main = this.#project().main;
    const want = wsGet<string | null>("editor.active", null);
    if (want && this.docs.some((d) => d.path === want)) await this.activate(want);
    else if (this.docs.length) await this.activate(this.docs[0].path);
    else if (main) await this.open(main);
  }

  dispose(): void {
    for (const f of this.#offs) f();
    void this.#unlisten?.then((f) => f());
    for (const d of this.docs) if (d.timer) clearTimeout(d.timer);
    if (this.#posTimer) clearTimeout(this.#posTimer);
  }

  /** Before the project goes away (switch, close, quit): save files, remember positions. */
  async flush(): Promise<void> {
    this.#persistPos();
    await this.saveAll();
  }

  attach(view: EditorView): void {
    this.view = view;
    const d = this.active;
    if (d?.state) this.#show(d);
  }

  detach(): void {
    if (this.view && this.#inView) {
      this.#inView.state = this.view.state;
      this.#inView.scroll = this.view.scrollSnapshot();
      this.#persistPos();
    }
    this.#inView = null;
    this.view = null;
  }

  // ── Opening and switching ──────────────────────────────────────────────────

  find(path: string): Doc | undefined {
    return this.docs.find((d) => d.path === path);
  }

  isDirty(path: string): boolean {
    return this.find(path)?.dirty ?? false;
  }

  /** Open a file in a tab. `preview`: a single-click tab that the next preview replaces. */
  async open(path: string, opts: { preview?: boolean; focus?: boolean } = {}): Promise<void> {
    const preview = opts.preview ?? false;
    let d = this.find(path);
    if (d) {
      if (!preview) d.preview = false;
    } else {
      d = new Doc(path, preview);
      const old = preview ? this.docs.findIndex((x) => x.preview && !x.dirty) : -1;
      if (old >= 0) {
        this.#forget(this.docs[old]);
        this.docs[old] = d;
      } else {
        const at = this.docs.findIndex((x) => x.path === this.activePath);
        this.docs.splice(at < 0 ? this.docs.length : at + 1, 0, d);
      }
    }
    await this.activate(path);
    if (opts.focus) this.view?.focus();
  }

  async activate(path: string): Promise<void> {
    const d = this.find(path);
    if (!d) return;
    this.#stash();
    this.activePath = path;
    this.#persistTabs();
    const recent = wsGet<string[]>("editor.recent", []);
    if (recent[0] !== path) wsSet("editor.recent", [path, ...recent.filter((p) => p !== path)].slice(0, 30));
    if (!d.state && d.kind !== "text") await this.#load(d);
    if (this.activePath !== path) return; // another tab was picked meanwhile
    this.#show(d);
  }

  /** Put the view's state back into its doc before showing another one. */
  #stash(): void {
    const d = this.#inView;
    if (d && this.view) {
      d.state = this.view.state;
      d.scroll = this.view.scrollSnapshot();
    }
    this.#inView = null;
  }

  #show(d: Doc): void {
    const view = this.view;
    if (!view || !d.state || d.kind !== "text") return;
    if (this.#inView === d) return;
    this.#stash();
    view.setState(d.state.update({ effects: prefEffects(prefs()) }).state);
    this.#inView = d;
    if (d.scroll) view.dispatch({ effects: d.scroll });
    else {
      const pos = wsGet<Record<string, Pos>>("editor.pos", {})[d.path];
      if (pos) view.dispatch({ effects: EditorView.scrollIntoView(Math.min(pos.top, view.state.doc.length), { y: "start" }) });
    }
  }

  async #load(d: Doc): Promise<void> {
    if (d.loading) return d.loading;
    d.loading = (async () => {
      const k = fileKind(d.name);
      if (k === "img" || k === "pdf") {
        d.kind = "binary";
        return;
      }
      try {
        const r = await call<ReadResult>("fs_read", { pid: this.pid, path: d.path, known: null });
        if (r.kind === "text") {
          d.crlf = r.crlf;
          d.bom = r.bom;
          d.stamp = r.stamp;
          d.state = this.#createState(d, r.text);
          d.saved = d.state.doc;
          const marks = this.#diags.get(d.path);
          if (marks?.length) d.state = d.state.update(diagnosticsSpec(d.state, marks)).state;
          d.kind = "text";
        } else if (r.kind !== "unchanged") {
          d.kind = r.kind;
          if ("size" in r) d.size = r.size;
        }
      } catch (e) {
        d.kind = "error";
        d.error = e instanceof Error ? e.message : String(e);
      }
    })();
    try {
      await d.loading;
    } finally {
      d.loading = null;
    }
  }

  #createState(d: Doc, text: string): EditorState {
    const pos = wsGet<Record<string, Pos>>("editor.pos", {})[d.path];
    const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
    return EditorState.create({
      doc: text,
      selection: pos ? EditorSelection.single(clamp(pos.anchor), clamp(pos.head)) : undefined,
      extensions: extensions(langFor(d.name), { onUpdate: (u) => this.#onUpdate(u), searchPanel }),
    });
  }

  /** The live state of a doc (the view's, if it is shown). */
  stateOf(d: Doc): EditorState | null {
    return this.#inView === d && this.view ? this.view.state : d.state;
  }

  cycle(dir: 1 | -1): boolean {
    if (this.docs.length < 2) return false;
    const i = this.docs.findIndex((d) => d.path === this.activePath);
    void this.activate(this.docs[(i + dir + this.docs.length) % this.docs.length].path);
    return true;
  }

  // ── Editing and saving ─────────────────────────────────────────────────────

  #onUpdate(u: ViewUpdate): void {
    const d = this.#inView;
    if (!d || u.view !== this.view) return;
    if (u.docChanged && !u.transactions.every((t) => t.annotation(Transaction.userEvent) === "external")) {
      d.dirty = true;
      d.preview = false;
      this.#scheduleSave(d);
    }
    if (u.selectionSet) this.#schedulePos();
    if ((u.selectionSet || u.docChanged) && this.#cursorCbs.size) {
      const line = u.state.doc.lineAt(u.state.selection.main.head).number;
      if (line !== this.#lastLine || d.path !== this.#lastPath) {
        this.#lastLine = line;
        this.#lastPath = d.path;
        for (const cb of this.#cursorCbs) cb({ path: d.path, line });
      }
    }
  }

  // ── Snippets ───────────────────────────────────────────────────────────────

  insertSnippet(body: string): boolean {
    const v = this.view;
    if (!v || this.#inView?.kind !== "text") return false;
    const sel = v.state.selection.main;
    const tpl = toTemplate(body, { selection: v.state.sliceDoc(sel.from, sel.to), filename: this.#inView.name });
    snippet(tpl)(v, null, sel.from, sel.to);
    v.focus();
    return true;
  }

  insertText(text: string): boolean {
    const v = this.view;
    if (!v || this.#inView?.kind !== "text") return false;
    const sel = v.state.selection.main;
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, userEvent: "input" });
    v.focus();
    return true;
  }

  selection(): { text: string; source: string } | null {
    const v = this.view;
    const d = this.#inView;
    if (!v || !d || d.kind !== "text") return null;
    const sel = v.state.selection.main;
    if (sel.empty) return null;
    const line = v.state.doc.lineAt(sel.from).number;
    return { text: v.state.sliceDoc(sel.from, sel.to), source: `${d.name}:${line}` };
  }

  insertAt(body: string, at?: { x: number; y: number }): boolean {
    const v = this.view;
    if (!v || this.#inView?.kind !== "text") return false;
    const pos = at ? v.posAtCoords(at) : null;
    if (pos !== null) v.dispatch({ selection: { anchor: pos } });
    return this.insertSnippet(body);
  }

  undo(): void {
    if (this.view) undoCmd(this.view);
  }

  // ── Cursor (SyncTeX follow) ────────────────────────────────────────────────

  #cursorCbs = new Set<(c: { path: string; line: number }) => void>();
  #lastLine = 0;
  #lastPath = "";

  cursor(): { path: string; line: number } | null {
    const d = this.#inView;
    const v = this.view;
    if (!d || !v || d.kind !== "text") return null;
    return { path: d.path, line: v.state.doc.lineAt(v.state.selection.main.head).number };
  }

  onCursor(cb: (c: { path: string; line: number }) => void): () => void {
    this.#cursorCbs.add(cb);
    return () => this.#cursorCbs.delete(cb);
  }

  #scheduleSave(d: Doc): void {
    if (d.timer) clearTimeout(d.timer);
    if (!getSetting("editor.autosave", true)) return;
    d.timer = setTimeout(() => void this.save(d), getSetting("editor.autosaveMs", 400));
  }

  async save(d: Doc, opts: { force?: boolean } = {}): Promise<void> {
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    if (d.saving) await d.saving;
    const st = this.stateOf(d);
    if (d.kind !== "text" || !st) return;
    // Never overwrite a newer disk version or recreate a deleted file on our own.
    if ((d.conflict || d.gone) && !opts.force) return;
    const doc = st.doc;
    if (d.saved && doc.eq(d.saved) && !opts.force) {
      d.dirty = false;
      return;
    }
    d.saving = (async () => {
      try {
        d.stamp = await call<Stamp>("fs_write", { pid: this.pid, path: d.path, text: doc.toString(), crlf: d.crlf, bom: d.bom });
        d.saved = doc;
        d.gone = false;
        const now = this.stateOf(d);
        d.dirty = !!now && !now.doc.eq(doc);
      } catch (e) {
        toast(`${d.name}: ${e instanceof Error ? e.message : String(e)}`, { icon: "alert", error: true, ms: 6000 });
      }
    })();
    try {
      await d.saving;
    } finally {
      d.saving = null;
    }
  }

  async saveAll(): Promise<string[]> {
    const dirty = this.docs.filter((d) => d.dirty);
    const before = new Map(dirty.map((d) => [d, d.stamp]));
    await Promise.all(dirty.map((d) => this.save(d)));
    return dirty.filter((d) => d.stamp !== before.get(d)).map((d) => d.path);
  }

  // ── Compile diagnostics ────────────────────────────────────────────────────

  setDiagnostics(list: BridgeDiagnostic[]): void {
    const next = new Map<string, BridgeDiagnostic[]>();
    for (const x of list) if (x.file) next.set(x.file, [...(next.get(x.file) ?? []), x]);
    const touched = new Set([...this.#diags.keys(), ...next.keys()]);
    this.#diags = next;
    for (const d of this.docs) {
      if (!touched.has(d.path)) continue;
      const st = this.stateOf(d);
      if (!st || d.kind !== "text") continue;
      const spec = diagnosticsSpec(st, next.get(d.path) ?? []);
      if (this.#inView === d && this.view) this.view.dispatch(spec);
      else d.state = st.update(spec).state;
    }
  }

  async reveal(path: string, line: number): Promise<void> {
    await this.open(path, { focus: true });
    const d = this.find(path);
    if (d && this.#inView === d && this.view) revealLine(this.view, line);
  }

  toggleWrap(): boolean {
    setSetting("editor.wrap", !prefs().wrap);
    return true;
  }

  /** Preferences changed → reconfigure the visible state (others on next show). */
  applyPrefs(): void {
    this.view?.dispatch({ effects: prefEffects(prefs()) });
  }

  // ── Closing ────────────────────────────────────────────────────────────────

  async close(path: string): Promise<void> {
    const d = this.find(path);
    if (!d) return;
    if (d.dirty && (d.gone || d.conflict)) {
      const what = await chooseOption(
        d.gone ? `„${d.name}” usunięto z dysku` : `„${d.name}” zmienił się na dysku`,
        "Karta ma niezapisane zmiany.",
        [
          { value: "save", label: d.gone ? "Zapisz ponownie" : "Zapisz moją", icon: "disk" },
          { value: "drop", label: "Porzuć zmiany", icon: "trash", danger: true },
        ],
      );
      if (!what) return;
      if (what === "save") await this.save(d, { force: true });
    } else if (d.dirty) await this.save(d);
    const i = this.docs.indexOf(d);
    if (this.#inView === d) this.#inView = null;
    this.#forget(d);
    this.docs.splice(i, 1);
    if (this.activePath === path) {
      const next = this.docs[Math.min(i, this.docs.length - 1)];
      this.activePath = null;
      if (next) await this.activate(next.path);
      else this.#persistTabs();
    } else this.#persistTabs();
  }

  async closeOthers(path: string): Promise<void> {
    for (const d of [...this.docs]) if (d.path !== path) await this.close(d.path);
  }

  async closeAll(): Promise<void> {
    for (const d of [...this.docs]) await this.close(d.path);
  }

  #forget(d: Doc): void {
    if (d.timer) clearTimeout(d.timer);
    const pos = { ...wsGet<Record<string, Pos>>("editor.pos", {}) };
    if (d.path in pos) {
      delete pos[d.path];
      wsSet("editor.pos", pos);
    }
  }

  reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.docs.length) return;
    const [d] = this.docs.splice(from, 1);
    this.docs.splice(Math.min(to, this.docs.length), 0, d);
    this.#persistTabs();
  }

  pin(path: string): void {
    const d = this.find(path);
    if (d?.preview) {
      d.preview = false;
      this.#persistTabs();
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  #persistTabs(): void {
    wsSet("editor.tabs", this.docs.map((d) => (d.preview ? { path: d.path, preview: true } : { path: d.path })));
    wsSet("editor.active", this.activePath);
  }

  #schedulePos(): void {
    if (this.#posTimer) clearTimeout(this.#posTimer);
    this.#posTimer = setTimeout(() => this.#persistPos(), 1000);
  }

  /** Cursor + top of viewport of the visible doc (others keep what they had). */
  #persistPos(): void {
    if (this.#posTimer) clearTimeout(this.#posTimer);
    this.#posTimer = null;
    const d = this.#inView;
    const view = this.view;
    if (!d || !view) return;
    const sel = view.state.selection.main;
    const top = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop)).from;
    const all = wsGet<Record<string, Pos>>("editor.pos", {});
    const old = all[d.path];
    if (old && old.anchor === sel.anchor && old.head === sel.head && old.top === top) return;
    const keep = new Set(this.docs.map((x) => x.path));
    const next: Record<string, Pos> = {};
    for (const [k, v] of Object.entries(all)) if (keep.has(k)) next[k] = v;
    next[d.path] = { anchor: sel.anchor, head: sel.head, top };
    wsSet("editor.pos", next);
  }

  /** Scrolling counts as a position change too (no ViewUpdate for plain scrolling). */
  noteScroll(): void {
    this.#schedulePos();
  }

  // ── Files moved / renamed in the tree ──────────────────────────────────────

  moved(moves: [string, string][]): void {
    let any = false;
    for (const d of this.docs) {
      for (const [from, to] of moves) {
        if (!isUnder(d.path, from)) continue;
        const before = langFor(d.name);
        if (this.activePath === d.path) this.activePath = to + d.path.slice(from.length);
        d.path = to + d.path.slice(from.length);
        d.gone = false;
        any = true;
        const after = langFor(d.name);
        if (after !== before) this.#reconfigureLang(d);
        break;
      }
    }
    if (any) this.#persistTabs();
  }

  #reconfigureLang(d: Doc): void {
    const effects = comp.lang.reconfigure(language(langFor(d.name)));
    if (this.#inView === d && this.view) this.view.dispatch({ effects });
    else if (d.state) d.state = d.state.update({ effects }).state;
  }

  // ── Changes from outside ───────────────────────────────────────────────────

  async #onDisk(paths: string[]): Promise<void> {
    const hit = this.docs.filter((d) => d.kind === "text" && d.state !== null && paths.some((p) => isUnder(d.path, p)));
    await Promise.all(hit.map((d) => this.#recheck(d)));
  }

  async #recheck(d: Doc): Promise<void> {
    if (d.saving) await d.saving;
    let r: ReadResult;
    try {
      r = await call<ReadResult>("fs_read", { pid: this.pid, path: d.path, known: d.stamp });
    } catch {
      return;
    }
    if (r.kind === "unchanged") return;
    if (r.kind === "missing") {
      d.gone = true;
      return;
    }
    d.gone = false;
    if (r.kind !== "text") return;
    d.stamp = r.stamp;
    const st = this.stateOf(d);
    if (!st) return;
    if (st.doc.toString() === r.text) {
      d.saved = st.doc;
      d.dirty = false;
      d.conflict = null;
      return;
    }
    if (!d.dirty) await this.#replace(d, r.text);
    else d.conflict = r.text;
  }

  /** Replace a doc's text with `text` by a minimal diff (cursor and folds stay). */
  async #replace(d: Doc, text: string): Promise<void> {
    const st = this.stateOf(d);
    if (!st) return;
    const { diff } = await import("@codemirror/merge");
    const cur = st.doc.toString();
    const changes = diff(cur, text, { scanLimit: 5000, timeout: 200 }).map((c) => ({ from: c.fromA, to: c.toA, insert: text.slice(c.fromB, c.toB) }));
    const spec = { changes, annotations: external };
    if (this.#inView === d && this.view) this.view.dispatch(spec);
    else d.state = st.update(spec).state;
    d.saved = (this.stateOf(d) as EditorState).doc;
    d.dirty = false;
  }

  // ── Conflict resolution ────────────────────────────────────────────────────

  async keepMine(d: Doc): Promise<void> {
    await this.#endCompare(d);
    d.conflict = null;
    await this.save(d, { force: true });
  }

  async takeTheirs(d: Doc): Promise<void> {
    const disk = d.conflict;
    await this.#endCompare(d);
    d.conflict = null;
    if (disk === null) return;
    await this.#replace(d, disk);
  }

  /** Unified diff against the disk version; per-chunk keep/take, then `keepMine`. */
  async compare(d: Doc): Promise<void> {
    if (!d.conflict || this.#inView !== d || !this.view) return;
    const { unifiedMergeView } = await import("@codemirror/merge");
    const { mergeButton } = await import("./mergeButtons.ts");
    this.view.dispatch({
      effects: comp.merge.reconfigure(unifiedMergeView({ original: d.conflict, mergeControls: mergeButton, syntaxHighlightDeletions: true })),
    });
    d.comparing = true;
  }

  async #endCompare(d: Doc): Promise<void> {
    if (!d.comparing) return;
    d.comparing = false;
    const effects = comp.merge.reconfigure([]);
    if (this.#inView === d && this.view) this.view.dispatch({ effects });
    else if (d.state) d.state = d.state.update({ effects }).state;
  }

  async cancelCompare(d: Doc): Promise<void> {
    await this.#endCompare(d);
  }
}
