// The user's shortcuts (`<data>/keybindings.json`): { "overrides": { "<command id>": "mod+b" } }.
// "" = the command has no shortcut. Absent = the default from the registry.

import { getOverrides, setOverrides } from "./commands.svelte.ts";
import { isMac } from "./keys.ts";
import { call, inTauri } from "./tauri.ts";

export async function loadKeybindings(): Promise<void> {
  if (!inTauri()) return;
  try {
    const v = await call<{ overrides?: Record<string, string> } | null>("userdata_get", { name: "keybindings" });
    setOverrides(v?.overrides ?? {});
  } catch (e) {
    console.error("[keys] load", e);
  }
}

async function save(o: Record<string, string>): Promise<void> {
  setOverrides(o);
  if (inTauri()) await call("userdata_set", { name: "keybindings", value: { overrides: o } });
}

/** keys = null → back to the default. */
export function bind(id: string, keys: string | null): Promise<void> {
  const o = { ...getOverrides() };
  if (keys === null) delete o[id];
  else o[id] = keys;
  return save(o);
}

/** Several at once (swap on a clash, VS Code import). */
export function bindMany(changes: Record<string, string | null>): Promise<void> {
  const o = { ...getOverrides() };
  for (const [id, keys] of Object.entries(changes)) {
    if (keys === null) delete o[id];
    else o[id] = keys;
  }
  return save(o);
}

export const resetAll = (): Promise<void> => save({});

/** VS Code command ids we understand (LaTeX Workshop and the editor basics). */
const VSCODE: Record<string, string> = {
  "latex-workshop.bold": "snippet.insert:bold",
  "latex-workshop.italic": "snippet.insert:italic",
  "latex-workshop.underline": "snippet.insert:underline",
  "latex-workshop.emphasis": "snippet.insert:emph",
  "latex-workshop.build": "build.compile",
  "latex-workshop.synctex": "sync.toPdf",
  "latex-workshop.kill": "build.cancel",
  "latex-workshop.navigate-envpair": "",
  "workbench.action.showCommands": "app.palette",
  "workbench.action.quickOpen": "app.quickOpen",
  "workbench.action.closeActiveEditor": "tab.close",
  "workbench.action.files.save": "build.compile",
  "editor.action.startFindReplaceAction": "editor.replace",
  "editor.action.toggleWordWrap": "editor.toggleWrap",
  "editor.action.marker.next": "build.nextError",
  "editor.action.marker.prev": "build.prevError",
  "editor.action.commentLine": "editor.comment",
};

/** VS Code "cmd+b" / "ctrl+b" → ours ("mod+b" for the platform's main modifier). */
export function fromVsCode(key: string, mac = isMac()): string {
  return key
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((stroke) =>
      stroke
        .split("+")
        .map((p) => (p === (mac ? "cmd" : "ctrl") ? "mod" : p === "win" || p === "meta" ? "cmd" : p))
        .join("+"),
    )
    .join(" ");
}

/** A VS Code keybindings.json array → changes for commands we have. */
export function importVsCode(entries: unknown, known: (id: string) => boolean, mac = isMac()): { changes: Record<string, string>; skipped: number } {
  const changes: Record<string, string> = {};
  let skipped = 0;
  if (!Array.isArray(entries)) return { changes, skipped };
  for (const e of entries) {
    const key = typeof e?.key === "string" ? e.key : null;
    const cmd = typeof e?.command === "string" ? e.command : null;
    if (!key || !cmd) continue;
    const removal = cmd.startsWith("-");
    const id = VSCODE[removal ? cmd.slice(1) : cmd] ?? (known(cmd.replace(/^-/, "")) ? cmd.replace(/^-/, "") : "");
    if (!id || !known(id)) {
      skipped++;
      continue;
    }
    if (removal) {
      if (!(id in changes)) changes[id] = "";
    } else changes[id] = fromVsCode(key, mac);
  }
  return { changes, skipped };
}
