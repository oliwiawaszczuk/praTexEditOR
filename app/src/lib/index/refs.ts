// After a rename / move of a .tex file, image or folder: offer to rewrite the \input,
// \include, \includegraphics… that pointed at it (docs/03-ux.md §3.1). Rust finds and
// rewrites; open buffers are saved first and pick the change up as an external edit.

import { call } from "#lib/core/tauri.ts";
import { editor } from "#lib/editor/bridge.svelte.ts";
import { confirmAction, showError } from "#lib/ui/dialogs.svelte.ts";
import { toast } from "#lib/ui/toast.svelte.ts";

interface RefEdit {
  file: string;
  line: number;
  old: string;
  new: string;
}

export async function updateRefs(pid: string, moves: [string, string][]): Promise<void> {
  if (!moves.length) return;
  try {
    const edits = await call<RefEdit[]>("refs_find", { pid, moves });
    if (!edits.length) return;
    const n = edits.length;
    const files = new Set(edits.map((e) => e.file)).size;
    const shown = edits
      .slice(0, 5)
      .map((e) => `${e.old} → ${e.new}`)
      .join("\n");
    const ok = await confirmAction(
      `Zaktualizować ${n} ${n === 1 ? "odwołanie" : n < 5 ? "odwołania" : "odwołań"}?`,
      `${shown}${n > 5 ? "\n…" : ""}\n(plików: ${files})`,
      { confirmText: "Zaktualizuj" },
    );
    if (!ok) return;
    await editor()?.saveAll();
    const changed = await call<string[]>("refs_apply", { pid, edits });
    toast(`Zaktualizowano odwołania w ${changed.length} ${changed.length === 1 ? "pliku" : "plikach"}`, { icon: "check" });
  } catch (err) {
    void showError("Nie udało się zaktualizować odwołań", err);
  }
}
