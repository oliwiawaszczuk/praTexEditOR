// Whiteboards (Tablica; Rust: boards.rs) — global, independent of projects, like Notatki.
// The app only remembers which board was open last (app settings).
//
// PDF clips go through `addImageToBoard`: if the Tablica tab currently shows that board,
// its canvas places the image (so its unsaved state is never overwritten); otherwise the
// board file is updated directly.

import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
import { call, callRaw, protoUrl } from "#lib/core/tauri.ts";

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type BoardTool = "select" | "draw" | "shape" | "text";
export type ShapeKind = "rect" | "ellipse";
export type TextAlign = "left" | "center" | "right";

interface Base {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}
export interface ImageObject extends Base {
  type: "image";
  assetUrl: string; // "<boardId>/<file>" (served as pratex://…/board/<boardId>?f=<file>)
  caption?: string; // e.g. "plik.pdf s. 4" for a PDF clip
}
export interface TextObject extends Base {
  type: "text";
  content: string;
  color: string;
  fontSize: number;
  bold: boolean;
  align: TextAlign;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
}
export interface DrawObject extends Base {
  type: "draw";
  points: number[]; // flat [x1, y1, …] relative to (x, y)
  color: string;
  strokeWidth: number;
}
export interface ShapeObject extends Base {
  type: "shape";
  shape: ShapeKind;
  fillColor: string;
  fillTransparent: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokeTransparent: boolean;
  cornerRadius: number;
}
export type BoardObject = ImageObject | TextObject | DrawObject | ShapeObject;

export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}
export interface BoardData {
  objects: BoardObject[];
  viewport: BoardViewport;
}

let list = $state<BoardMeta[]>([]);
let loaded = $state(false);

export const boards = (): BoardMeta[] => list;
export const boardsLoaded = (): boolean => loaded;

export async function loadBoards(): Promise<BoardMeta[]> {
  list = await call<BoardMeta[]>("boards_list");
  loaded = true;
  return list;
}
export async function createBoard(name: string): Promise<BoardMeta> {
  const b = await call<BoardMeta>("boards_create", { name });
  await loadBoards();
  return b;
}
export async function renameBoard(id: string, name: string): Promise<void> {
  await call("boards_rename", { id, name });
  await loadBoards();
}
export async function deleteBoard(id: string): Promise<void> {
  await call("boards_delete", { id });
  await loadBoards();
}
export const getBoard = (id: string): Promise<BoardData> => call<BoardData>("board_get", { id });

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { id: string; data: BoardData } | null = null;

export function scheduleSaveBoard(id: string, data: BoardData): void {
  if (pending && pending.id !== id) void flushBoard();
  pending = { id, data };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushBoard(), 800);
}

export async function flushBoard(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  if (!p) return;
  try {
    await call("board_set", { id: p.id, data: $state.snapshot(p.data) });
    const e = list.find((b) => b.id === p.id);
    if (e) e.updatedAt = Date.now();
  } catch (e) {
    console.error("[board] save failed", e);
  }
}

/** Raw image bytes into the board's assets; returns the object's `assetUrl`. */
export async function uploadAsset(boardId: string, blob: Blob, ext = "png"): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const file = await callRaw<string>("board_asset_add", bytes, { id: boardId, ext });
  return `${boardId}/${file}`;
}

export async function assetFromPath(boardId: string, path: string): Promise<string> {
  return `${boardId}/${await call<string>("board_asset_from_path", { id: boardId, path })}`;
}

export function assetUrl(url: string): string {
  const [bid, file] = url.split("/");
  return protoUrl(`board/${bid}`, { f: file });
}

// ── the board currently open in the Tablica tab (clips land there live) ──
type Placer = (assetUrl: string, w: number, h: number, caption: string) => void;
let live: { boardId: string; place: Placer } | null = null;

export function registerLiveBoard(boardId: string | null, place: Placer | null): void {
  live = boardId && place ? { boardId, place } : null;
}

/** The board clips go to: the last opened one, else the first, else a new "Tablica 1". */
export async function targetBoard(): Promise<BoardMeta> {
  if (!loaded) await loadBoards();
  const saved = getSetting<string>("tablica.activeBoardId", "");
  const b = list.find((x) => x.id === saved) ?? list[0];
  if (b) return b;
  const n = await createBoard("Tablica 1");
  setSetting("tablica.activeBoardId", n.id);
  return n;
}

/** A picture (e.g. a PDF clip) onto the target board; returns the board's name. */
export async function addImageToBoard(blob: Blob, w: number, h: number, caption: string): Promise<string> {
  const b = await targetBoard();
  const url = await uploadAsset(b.id, blob);
  if (live?.boardId === b.id) {
    live.place(url, w, h, caption);
    return b.name;
  }
  await flushBoard(); // never race a pending save of the same board
  const data = await getBoard(b.id);
  const z = data.objects.reduce((m, o) => Math.max(m, o.zIndex), -1) + 1;
  // to the right of everything already there, top-aligned
  const right = data.objects.reduce((m, o) => Math.max(m, o.x + o.width), 0);
  const top = data.objects.length ? Math.min(...data.objects.map((o) => o.y)) : 0;
  const scale = Math.min(1, 480 / Math.max(w, h));
  const img: ImageObject = {
    id: crypto.randomUUID(),
    type: "image",
    assetUrl: url,
    caption,
    x: data.objects.length ? right + 40 : 0,
    y: top,
    width: w * scale,
    height: h * scale,
    rotation: 0,
    opacity: 1,
    zIndex: z,
  };
  data.objects.push(img);
  if (caption) {
    // the same visible caption the live canvas adds (BoardCanvas.placeImage)
    data.objects.push({
      id: crypto.randomUUID(),
      type: "text",
      content: caption,
      x: img.x,
      y: img.y + img.height + 8,
      width: img.width,
      height: 24,
      rotation: 0,
      opacity: 1,
      zIndex: z + 1,
      color: "#bbbbbb",
      fontSize: 14,
      bold: false,
      align: "left",
      borderEnabled: false,
      borderColor: "#000000",
      borderWidth: 1.5,
    });
  }
  await call("board_set", { id: b.id, data });
  await loadBoards();
  return b.name;
}

// OS file drops while the Tablica tab is shown (the webview only gets paths)
let dropHandler: ((paths: string[]) => void) | null = null;
export function registerBoardDrop(fn: ((paths: string[]) => void) | null): void {
  dropHandler = fn;
}
/** true when the board took the drop (images only). */
export function dropOnBoard(paths: string[]): boolean {
  const imgs = paths.filter((p) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p));
  if (!dropHandler || !imgs.length) return false;
  dropHandler(imgs);
  return true;
}

/** Save dialog + write; returns the path, null when cancelled. */
export async function savePng(blob: Blob, name: string): Promise<string | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return callRaw<string | null>("board_export_png", bytes, { name: encodeURIComponent(name) });
}
