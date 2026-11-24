// praBada link. This app owns the TeX folder; praBada is only pointed at: a project here
// remembers which praBada workspace it belongs to, and `[[EXP-0007]]` in the text jumps there.

import { currentProject, wsGet, wsSet } from "#lib/core/projects.svelte.ts";
import { call } from "#lib/core/tauri.ts";
import { chooseOption, showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

const KEY = "bada.ws";

interface Linked {
  id: string;
  name: string;
}

interface WsList {
  workspaces: { id: string; name: string; color: string }[];
}

export const linkedWs = (): Linked | null => wsGet<Linked | null>(KEY, null);

/** Ids of praBada things written as `[[ID]]` in a line, in order. */
export function refsIn(text: string): string[] {
  return [...text.matchAll(/\[\[([A-Za-z]+-\d+)\]\]/g)].map((m) => m[1]!);
}

export async function linkProject(): Promise<boolean> {
  if (!currentProject()) return false;
  try {
    const { workspaces } = await call<WsList>("bada_send", { req: { op: "ws.list" } });
    if (!workspaces.length) {
      await showError("praBada", "praBada nie ma jeszcze żadnego projektu");
      return true;
    }
    const pick = await chooseOption(
      "Projekt w praBada",
      "Do którego projektu praBada należy ten projekt LaTeX?",
      workspaces.slice(0, 8).map((w) => ({ value: w.id, label: w.name, icon: "project" as const })),
    );
    const w = workspaces.find((x) => x.id === pick);
    if (w) {
      wsSet(KEY, { id: w.id, name: w.name });
      toast(`Połączono z „${w.name}” w praBada`, { icon: "link" });
    }
  } catch (e) {
    void showError("Nie udało się połączyć z praBada", e);
  }
  return true;
}

export async function openInBada(id?: string): Promise<boolean> {
  let ws = linkedWs();
  if (!ws) {
    await linkProject();
    ws = linkedWs();
    if (!ws) return true;
  }
  try {
    await call("bada_send", { req: { op: "open", ws: ws.id, ...(id ? { id } : {}) } });
  } catch (e) {
    void showError("Nie udało się otworzyć w praBada", e);
  }
  return true;
}

/** Jump to the first `[[ID]]` on the cursor's line (the project itself when there is none). */
export const openRefAt = (lineText: string | null): Promise<boolean> => openInBada(lineText ? refsIn(lineText)[0] : undefined);
