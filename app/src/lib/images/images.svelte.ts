// Images into the document (docs/03-ux.md §6): a screenshot pasted with ⌘V, or files
// dropped from Finder onto the editor. The file goes to the project's image folder
// (`imgDir`, remembered per project), the code goes where the cursor / drop point is —
// `\includegraphics` or a whole `figure` with the cursor in `\caption{}`.
// The small dialog (name, folder, plain / figure) is skipped with "nie pytaj".

import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
import { baseName, currentProject, parentDir, wsGet, wsSet } from "#lib/core/projects.svelte.ts";
import { call, callRaw } from "#lib/core/tauri.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { showCol } from "#lib/tabs/projekt/layout.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export type ImageMode = "plain" | "figure";

export interface ImageAsk {
  url: string;
  name: string;
  ext: string;
  dir: string;
  dirs: string[];
  mode: ImageMode;
  noAsk: boolean;
  resolve: (r: { name: string; dir: string; mode: ImageMode; noAsk: boolean } | null) => void;
}

let ask = $state<ImageAsk | null>(null);
export const imageAsk = (): ImageAsk | null => ask;

const IMG = /\.(png|jpe?g|pdf|eps|svg|gif|bmp|tiff?|webp)$/i;
const TEX = /\.tex$/i;
const norm = (p: string) => p.replace(/\\/g, "/");

/** Relative path from folder `from` to `to` ("/" separators, "../" when needed). */
export function relPath(from: string, to: string): string {
  const a = norm(from).split("/").filter(Boolean);
  const b = norm(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

/** VS Code snippet syntax: `$ } \` in a path are literal. */
const lit = (s: string) => s.replace(/[\\$}]/g, (c) => `\\${c}`);

export function imageCode(rel: string, mode: ImageMode, label: string): string {
  const p = lit(rel);
  if (mode === "plain") return `\\includegraphics[width=\${1:0.8}\\textwidth]{${p}}$0`;
  return `\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{${p}}\n\t\\caption{\${1}}\n\t\\label{fig:${lit(label)}}\n\\end{figure}\n$0`;
}

/** "Wykres 3 (kopia).png" → "wykres-3-kopia" (a safe TeX file name and label). */
export function slug(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "obraz"
  );
}

function mainDir(): string | null {
  const p = currentProject();
  return p?.main ? parentDir(p.main) : (p?.roots[0] ?? null);
}

async function folders(): Promise<string[]> {
  const p = currentProject();
  if (!p) return [];
  try {
    const es = await call<{ path: string; dir: boolean }[]>("fs_files", { pid: p.id });
    return [...p.roots, ...es.filter((e) => e.dir).map((e) => e.path)];
  } catch {
    return [...p.roots];
  }
}

/** The project's image folder: remembered, else an existing img/figures/… next to the
 * main file, else `<main dir>/img` (created on first write). */
async function imgDir(dirs: string[]): Promise<string> {
  const saved = wsGet<string | null>("img.dir", null);
  if (saved) return saved;
  const base = mainDir() ?? "";
  for (const n of ["img", "images", "figures", "fig", "obrazy", "rysunki", "grafika"]) {
    const d = `${base}/${n}`;
    if (dirs.includes(d)) return d;
  }
  return `${base}/img`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `zrzut-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function insert(path: string, mode: ImageMode, at?: { x: number; y: number }): boolean {
  const base = mainDir();
  if (!base) return false;
  showCol("mid");
  return editor()?.insertAt(imageCode(relPath(base, path), mode, slug(baseName(path))), at) ?? false;
}

/** ⌘V with an image in the clipboard. */
export async function pasteImage(blob: Blob): Promise<void> {
  const p = currentProject();
  if (!p) return;
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/gif" ? "gif" : "png";
  const dirs = await folders();
  let dir = await imgDir(dirs);
  let name = stamp();
  let mode = getSetting<ImageMode>("img.mode", "figure");
  if (!getSetting("img.noAsk", false)) {
    const url = URL.createObjectURL(blob);
    const r = await new Promise<{ name: string; dir: string; mode: ImageMode; noAsk: boolean } | null>((resolve) => {
      ask = { url, name, ext, dir, dirs: dirs.includes(dir) ? dirs : [dir, ...dirs], mode, noAsk: false, resolve };
    });
    ask = null;
    URL.revokeObjectURL(url);
    if (!r) return;
    ({ name, dir, mode } = r);
    setSetting("img.mode", mode);
    if (r.noAsk) setSetting("img.noAsk", true);
  }
  wsSet("img.dir", dir);
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const file = `${slug(name)}.${ext}`;
    const path = await callRaw<string>("fs_write_image", bytes, { pid: encodeURIComponent(p.id), dir: encodeURIComponent(dir), name: encodeURIComponent(file) });
    insert(path, mode);
    if (getSetting("img.noAsk", false)) {
      toast(`Wstawiono ${baseName(path)}`, {
        icon: "image",
        ms: 6000,
        action: () => {
          editor()?.undo();
          void call("fs_trash", { pid: p.id, paths: [path] });
        },
      });
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
  }
}

/** Files from Finder dropped onto the editor at window point `at`. Images are copied to
 * the image folder (files already in the project are only referenced), `.tex` files
 * become `\input{…}`. */
export async function dropFiles(paths: string[], at: { x: number; y: number }): Promise<void> {
  const p = currentProject();
  const base = mainDir();
  if (!p || !base) return;
  const inside = (f: string) => p.roots.some((r) => f === r || f.startsWith(r + "/") || f.startsWith(r + "\\"));
  const imgs = paths.filter((f) => IMG.test(f));
  const texs = paths.filter((f) => TEX.test(f));
  if (!imgs.length && !texs.length) {
    toast("Na edytor upuść obraz albo plik .tex", { icon: "image" });
    return;
  }
  try {
    const mode = getSetting<ImageMode>("img.mode", "figure");
    const dir = await imgDir(await folders());
    wsSet("img.dir", dir);
    const placed: string[] = imgs.filter(inside);
    const outside = imgs.filter((f) => !inside(f));
    if (outside.length) {
      await call("fs_ensure_dir", { pid: p.id, dir });
      const t = await call<{ done: [string, string][] }>("fs_transfer", { pid: p.id, sources: outside, target: dir, copy: true, policy: "keepBoth" });
      placed.push(...t.done.map(([, to]) => to));
    }
    let first = true;
    for (const f of placed) {
      insert(f, mode, first ? at : undefined);
      first = false;
    }
    for (const f of texs) {
      let target = f;
      if (!inside(f)) {
        const t = await call<{ done: [string, string][] }>("fs_transfer", { pid: p.id, sources: [f], target: base, copy: true, policy: "keepBoth" });
        target = t.done[0]?.[1] ?? f;
      }
      editor()?.insertAt(`\\input{${lit(relPath(base, target).replace(/\.tex$/i, ""))}}$0`, first ? at : undefined);
      first = false;
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
  }
}
