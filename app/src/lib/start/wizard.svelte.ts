// New-project flows. The wizard modal (NewProject.svelte) shows the steps; folder and
// zip flows can also start from the menu bar or a Finder drop and only open the modal
// when there is a real question (which file is the main one).

import { goTo } from "#lib/core/nav.svelte.ts";
import {
  baseName,
  createFromFolders,
  detectMain,
  nextColor,
  openProject,
  projects,
  type MainCandidate,
} from "#lib/core/projects.svelte.ts";
import { inTauri, pickDirectory } from "#lib/core/tauri.ts";
import { showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export type Step = "pick" | "template" | "zip" | "main";

export interface WizardState {
  step: Step;
  /** zip: the archive; main: the folder whose main file we ask for. */
  path?: string;
  name?: string;
  candidates?: MainCandidate[];
}

let state = $state<WizardState | null>(null);

export const wizard = (): WizardState | null => state;
export const openWizard = (step: Step = "pick"): void => {
  state = { step };
};
export const setWizard = (s: WizardState | null): void => {
  state = s;
};
export const closeWizard = (): void => {
  state = null;
};

export async function finishProject(id: string): Promise<void> {
  state = null;
  await openProject(id);
  goTo("projekt");
}

/** Existing folder → project. Asks only when several files could be the main one. */
export async function folderFlow(dir?: string | null): Promise<void> {
  dir ??= await pickDirectory("Wybierz folder z projektem LaTeX");
  if (!dir) return;
  const existing = projects().find((p) => p.roots.includes(dir));
  if (existing) {
    toast(`Ten folder to już projekt „${existing.name}”`, { icon: "project" });
    await finishProject(existing.id);
    return;
  }
  try {
    const candidates = await detectMain(dir);
    if (candidates.length > 1) {
      state = { step: "main", path: dir, name: baseName(dir), candidates };
      return;
    }
    const p = await createFromFolders(baseName(dir), [dir], candidates[0]?.path ?? null, nextColor());
    await finishProject(p.id);
  } catch (e) {
    void showError("Nie udało się utworzyć projektu", e);
  }
}

export async function zipFlow(): Promise<void> {
  if (!inTauri()) return;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ title: "Wybierz archiwum ZIP", filters: [{ name: "ZIP", extensions: ["zip", "ZIP"] }] });
  if (typeof r !== "string") return;
  state = { step: "zip", path: r, name: baseName(r).replace(/\.zip$/i, "") };
}

/** Folders dropped from Finder onto the start screen: each becomes a project. */
export async function dropFolders(paths: string[]): Promise<void> {
  for (const p of paths) await folderFlow(p);
}
