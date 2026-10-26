// Snippets that need a package ("amsmath", "graphicx"…): after inserting one, the project's
// preamble is checked (main file + the files it \input's); when the package is missing a toast
// offers to add the \usepackage line (click = add), so a fresh snippet does not start with an error.

import { currentProject } from "#lib/core/projects.svelte.ts";
import { call } from "#lib/core/tauri.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

export async function ensurePackages(requires: string | undefined): Promise<void> {
  const project = currentProject();
  if (!requires || !project?.main) return;
  try {
    const missing = await call<string[]>("packages_missing", { pid: project.id, requires: requires.split(",").map((r) => r.trim()).filter(Boolean) });
    if (!missing.length) return;
    toast(`Brakuje pakietu ${missing.join(", ")} w preambule — kliknij, aby dodać \\usepackage`, {
      icon: "func",
      ms: 8000,
      action: () => void add(project.id, missing),
    });
  } catch {
    // no main file / no shell: nothing to check
  }
}

async function add(pid: string, packages: string[]): Promise<void> {
  try {
    await editor()?.saveAll(); // the main file may be open with unsaved text
    await call("preamble_add", { pid, packages });
    toast(`Dodano \\usepackage{${packages.join(", ")}}`, { icon: "check" });
  } catch (e) {
    void showError("Nie udało się dodać pakietu", e);
  }
}
