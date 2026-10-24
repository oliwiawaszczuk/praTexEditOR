// Hovering the path of \includegraphics{…} shows the image (docs/03-ux.md §4).
// The file is found among the project's files; shown through pratex://, never via IPC.

import { hoverTooltip } from "@codemirror/view";
import { currentProject } from "#lib/core/projects.svelte.ts";
import { call, protoUrl } from "#lib/core/tauri.ts";

const GRAPHIC = /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)\}/g;
const RASTER = /\.(png|jpe?g|gif|webp|svg)$/i;

async function find(pid: string, arg: string): Promise<string | null> {
  const es = await call<{ path: string; dir: boolean }[]>("fs_files", { pid });
  const want = "/" + arg.replace(/^\.\//, "");
  const bare = RASTER.test(arg) ? null : want;
  const hit = es.find((e) => !e.dir && RASTER.test(e.path) && (e.path.endsWith(want) || (bare && e.path.replace(/\.\w+$/, "").endsWith(bare))));
  return hit?.path ?? null;
}

export const imageHover = hoverTooltip(
  async (view, pos) => {
    const project = currentProject();
    if (!project) return null;
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(GRAPHIC)) {
      const argFrom = line.from + (m.index ?? 0) + m[0].lastIndexOf("{") + 1;
      const argTo = argFrom + m[1].length;
      if (pos < argFrom || pos > argTo) continue;
      const path = await find(project.id, m[1].trim());
      if (!path) return null;
      return {
        pos: argFrom,
        end: argTo,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-thumb-tip";
          const img = document.createElement("img");
          img.className = "cm-thumb";
          img.src = protoUrl(`file/${project.id}`, { p: path });
          dom.append(img);
          return { dom };
        },
      };
    }
    return null;
  },
  { hideOnChange: true },
);
