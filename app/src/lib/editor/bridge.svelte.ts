// What the rest of the app may ask of the editor, without importing CodeMirror: the
// editor is a separate chunk loaded with the project view (docs/02-plan.md §11).

export interface EditorBridge {
  open(path: string, opts?: { preview?: boolean; focus?: boolean }): Promise<void>;
  isDirty(path: string): boolean;
  /** Files/folders moved or renamed in the tree: open tabs follow. */
  moved(moves: [string, string][]): void;
  /** Save every changed tab; resolves with the paths actually written. */
  saveAll(): Promise<string[]>;
  /** Compile diagnostics → marks in the editor (all files at once; replaces the old). */
  setDiagnostics(list: BridgeDiagnostic[]): void;
  /** Open `path`, put the cursor on `line` and flash it. */
  reveal(path: string, line: number): Promise<void>;
  /** Insert a VS Code style snippet at the selection (wrapping it). False = no text editor. */
  insertSnippet(body: string): boolean;
  /** Insert plain text / a snippet at a window point (drop) or at the cursor. */
  insertAt(body: string, at?: { x: number; y: number }): boolean;
  /** Insert literal text at the selection (replacing it). False = no text editor. */
  insertText(text: string): boolean;
  /** Is the cursor inside a formula (`$…$`, `\[…\]`, equation…)? */
  inMath(): boolean;
  /** Move the cursor by `delta` characters (negative = back). */
  moveCursor(delta: number): void;
  /** Selected text of the visible file with its place (`plik.tex:12`), null when empty. */
  selection(): { text: string; source: string } | null;
  /** Undo the last edit of the visible file. */
  undo(): void;
  /** File and 1-based line of the cursor in the visible text tab. */
  cursor(): { path: string; line: number } | null;
  /** Cursor moved to another line (or another file); returns the unsubscribe. */
  onCursor(cb: (c: { path: string; line: number }) => void): () => void;
}

export interface BridgeDiagnostic {
  severity: "error" | "warning" | "box";
  file: string | null;
  line: number | null;
  message: string;
  hint: string | null;
}

let current = $state<EditorBridge | null>(null);

export const editor = (): EditorBridge | null => current;
export function setEditor(e: EditorBridge | null): void {
  current = e;
}
