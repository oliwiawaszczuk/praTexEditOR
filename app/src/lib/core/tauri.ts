// Tauri bridge. Every call degrades gracefully in a plain browser (`pnpm dev` without
// the shell), so layout work does not need the native app running.

import { beginBusy } from "./busy.svelte.ts";

export const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** invoke() with the global busy indicator. Rejects with the Rust error string. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) throw new Error(`Brak powłoki Tauri (${cmd})`);
  const { invoke } = await import("@tauri-apps/api/core");
  const end = beginBusy();
  try {
    return await invoke<T>(cmd, args);
  } finally {
    end();
  }
}

/** invoke() with a raw binary body (no JSON): pasted images. Header values must be
 * ASCII, so callers percent-encode them. */
export async function callRaw<T>(cmd: string, body: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!inTauri()) throw new Error(`Brak powłoki Tauri (${cmd})`);
  const { invoke } = await import("@tauri-apps/api/core");
  const end = beginBusy();
  try {
    return await invoke<T>(cmd, body, { headers });
  } finally {
    end();
  }
}

/** Subscribe to a Rust event; returns the unsubscribe function. */
export async function on<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => cb(e.payload));
}

/** The shell intercepts the window close and emits `close-requested`; we flush pending
 * debounced saves, then destroy the window (Rust then kills child processes). */
export async function onCloseRequested(beforeClose: () => Promise<void>): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return on("close-requested", async () => {
    try {
      await Promise.race([beforeClose(), new Promise((r) => setTimeout(r, 1500))]);
    } finally {
      await getCurrentWindow().destroy();
    }
  });
}

/** URL on our `pratex://` protocol (Rust: protocol.rs), e.g. protoUrl("pdf/<pid>", { v: rev }).
 * Bytes go straight from disk to the webview, no IPC. */
export function protoUrl(route: string, query: Record<string, string | number> = {}): string {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc(p: string, proto: string): string } }).__TAURI_INTERNALS__;
  const base = internals ? internals.convertFileSrc(route, "pratex") : `/${route}`;
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  return q ? `${base}?${q}` : base;
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

export interface OsDrag {
  over: (x: number, y: number) => void;
  leave: () => void;
  drop: (paths: string[], x: number, y: number) => void;
}

/** Files dragged in from the OS (HTML5 drop events carry no paths in a webview).
 * Positions are physical pixels. */
export async function onOsDrag(cb: OsDrag): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") cb.over(p.position.x, p.position.y);
    else if (p.type === "leave") cb.leave();
    else if (p.type === "drop") cb.drop(p.paths, p.position.x, p.position.y);
  });
}

export type ProjectMenuAction = "new" | "folder" | "all";

export const onProjectMenu = (cb: (a: ProjectMenuAction) => void): Promise<() => void> => on<ProjectMenuAction>("project-menu", cb);
