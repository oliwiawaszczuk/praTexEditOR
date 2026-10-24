// CodeMirror search panel = our Svelte SearchPanel mounted into the panel DOM.

import { openSearchPanel } from "@codemirror/search";
import type { EditorView, Panel } from "@codemirror/view";
import { mount, unmount } from "svelte";
import SearchPanel from "./SearchPanel.svelte";

type Instance = ReturnType<typeof mount<{ view: EditorView; replace?: boolean }, { openReplace(): void; refresh(u: import("@codemirror/view").ViewUpdate): void }>>;

let current: Instance | null = null;
let wantReplace = false;

export function searchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  const inst = mount(SearchPanel, { target: dom, props: { view, replace: wantReplace } }) as Instance;
  wantReplace = false;
  return {
    dom,
    top: true,
    mount() {
      current = inst;
      // Query the DOM: bind:this is set by an effect, which may not have run yet.
      const input = dom.querySelector<HTMLInputElement>("[main-field]");
      input?.focus();
      input?.select();
    },
    update(u) {
      inst.refresh(u);
    },
    destroy() {
      if (current === inst) current = null;
      void unmount(inst);
    },
  };
}

/** ⌘⌥F: the panel with the replace row open. */
export function openReplace(view: EditorView): void {
  if (current) {
    openSearchPanel(view);
    current.openReplace();
  } else {
    wantReplace = true;
    openSearchPanel(view);
  }
}
