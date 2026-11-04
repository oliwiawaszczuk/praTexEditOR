// Template "Studia": which subject / note a file belongs to (mirrors src-tauri/src/studia.rs).
// Layout: <root>/<subject>/main.tex + <root>/<subject>/content/01_x.tex …

export type Scope = "subject" | "note";

export interface Target {
  subject: string;
  note?: string | null;
}

const SEP = /[\\/]/;

/** Subject folder (first folder under `root`) holding `path`; null for the root itself or outside it. */
export function subjectOf(root: string, path: string | null, isDir = false): string | null {
  if (!path || !(path.startsWith(root + "/") || path.startsWith(root + "\\"))) return null;
  const parts = path.slice(root.length + 1).split(SEP).filter(Boolean);
  if (parts.length < (isDir ? 1 : 2)) return null;
  return root + path[root.length] + parts[0];
}

/** `<subject>/content/<file>.tex` → the note, else null. */
export function noteOf(root: string, path: string | null): string | null {
  const subject = subjectOf(root, path);
  if (!subject || !path) return null;
  const parts = path.slice(subject.length + 1).split(SEP);
  return parts.length === 2 && parts[0] === "content" && parts[1].endsWith(".tex") && !parts[1].startsWith(".") ? path : null;
}

/** What to compile for `file`: a note when asked and the file is one, else its subject. */
export function resolveTarget(root: string, file: string | null, scope: Scope, isDir = false): Target | null {
  const subject = subjectOf(root, file, isDir);
  if (!subject) return null;
  const note = scope === "note" ? noteOf(root, file) : null;
  return note ? { subject, note } : { subject };
}

export const targetKey = (t: Target | null): string => (t ? `${t.subject}|${t.note ?? ""}` : "");

export const subjectName = (subject: string): string => subject.split(SEP).filter(Boolean).pop() ?? subject;
