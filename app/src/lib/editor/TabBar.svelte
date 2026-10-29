<script lang="ts">
  // Editor tabs (docs/03-ux.md §3.2): dot = unsaved, × / middle click / ⌘W closes,
  // italic = preview (replaced by the next single click in the tree), drag to reorder.
  import { tick } from "svelte";
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import { currentProject, type Project } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import { revealInOs, revealLabel } from "#lib/core/os.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { fileKind, KIND_ICON, kindColor } from "#lib/tree/kinds.ts";
  import { activeTree } from "#lib/tree/tree.svelte.ts";
  import type { Doc, Docs } from "./docs.svelte.ts";

  let { docs }: { docs: Docs } = $props();

  let strip = $state<HTMLDivElement>();
  let drag = $state<{ from: number; to: number; x0: number; moved: boolean } | null>(null);

  const project = $derived(currentProject() as Project);

  /** "rootFolder/rozdz/wstep.tex" — the name is visible, the tooltip says where it is. */
  function where(path: string): string {
    const root = project.roots.find((r) => path.startsWith(r + "/") || path.startsWith(r + "\\"));
    if (!root) return path;
    const rootName = root.split(/[\\/]/).pop() ?? root;
    return `${rootName}${path.slice(root.length).replaceAll("\\", "/")}`;
  }

  // Keep the active tab in view.
  $effect(() => {
    const p = docs.activePath;
    if (!p) return;
    void tick().then(() => strip?.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  function down(e: PointerEvent, i: number): void {
    if (e.button === 1) {
      e.preventDefault(); // middle click closes (auxclick); no autoscroll
      return;
    }
    if (e.button !== 0) return;
    drag = { from: i, to: i, x0: e.clientX, moved: false };
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 5) return;
      drag.moved = true;
      const tabs = [...(strip?.querySelectorAll<HTMLElement>(".tab") ?? [])];
      let to = tabs.length - 1;
      for (let k = 0; k < tabs.length; k++) {
        const r = tabs[k].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          to = k;
          break;
        }
      }
      drag.to = to > drag.from ? to - 1 : to;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (drag?.moved) {
        docs.reorder(drag.from, drag.to);
        // The click that ends the drag must not also activate (same-moment swallow).
        const swallow = (ev: MouseEvent) => ev.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
      drag = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function menu(e: MouseEvent, d: Doc): void {
    openMenu(e, [
      { icon: "close", label: "Zamknij", keys: keysOf("tab.close"), run: () => void docs.close(d.path) },
      { icon: "close", label: "Zamknij pozostałe", disabled: docs.docs.length < 2, run: () => void docs.closeOthers(d.path) },
      { icon: "close", label: "Zamknij wszystkie", run: () => void docs.closeAll() },
      "sep",
      { icon: "folder", label: "Pokaż w drzewie", run: () => void activeTree()?.reveal(d.path) },
      { icon: "copy", label: "Kopiuj ścieżkę względną", run: () => void copyRel(d.path) },
      { icon: "reveal", label: revealLabel(), disabled: d.gone, run: () => revealInOs(project.id, d.path) },
    ]);
  }

  async function copyRel(path: string): Promise<void> {
    const rel = activeTree()?.relPath(path) ?? path;
    await navigator.clipboard.writeText(rel);
    toast(`Skopiowano: ${rel}`, { icon: "copy" });
  }

  function wheel(e: WheelEvent): void {
    if (strip && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.scrollLeft += e.deltaY;
  }
</script>

<div class="bar">
  <div class="strip" bind:this={strip} onwheel={wheel} role="tablist">
    {#each docs.docs as d, i (d.path)}
      {@const k = fileKind(d.name)}
      <div
        class="tab"
        class:active={d.path === docs.activePath}
        class:preview={d.preview}
        class:gone={d.gone}
        class:dragging={drag?.moved && drag.from === i}
        class:before={drag?.moved && drag.to === i && drag.to < drag.from}
        class:after={drag?.moved && drag.to === i && drag.to > drag.from}
        data-path={d.path}
        role="tab"
        tabindex="-1"
        aria-selected={d.path === docs.activePath}
        use:tip={where(d.path)}
        onpointerdown={(e) => down(e, i)}
        onclick={() => void docs.activate(d.path)}
        ondblclick={() => docs.pin(d.path)}
        onauxclick={(e) => {
          if (e.button === 1) void docs.close(d.path);
        }}
        oncontextmenu={(e) => menu(e, d)}
        onkeydown={() => {}}
      >
        <span class="ico" style:color={kindColor(k)}><Icon name={KIND_ICON[k]} size={13} /></span>
        <span class="name">{d.name}</span>
        {#if d.conflict}<span class="warn"><Icon name="alert" size={11} /></span>{/if}
        <button
          class="x"
          class:dirty={d.dirty}
          aria-label="Zamknij"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            void docs.close(d.path);
          }}
        >
          <span class="dot"></span>
          <Icon name="close" size={11} />
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .bar {
    flex-shrink: 0;
    height: 36px;
    display: flex;
    background: var(--bg-panel-2);
    border-bottom: 1px solid var(--line-1);
  }
  .strip {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tab {
    position: relative;
    flex-shrink: 0;
    max-width: 220px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 11px;
    font-size: var(--fs-md);
    color: var(--text-dim-2);
    border-right: 1px solid var(--line-1);
    cursor: default;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .tab:hover {
    background: var(--hover);
    color: var(--text-dim-1);
  }
  .tab.active {
    background: var(--editor-bg);
    color: var(--text-strong);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab.preview .name {
    font-style: italic;
  }
  .tab.gone .name {
    text-decoration: line-through;
    color: var(--danger);
  }
  .tab.dragging {
    opacity: 0.45;
  }
  .tab.before::before,
  .tab.after::after {
    content: "";
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--accent);
  }
  .tab.before::before {
    left: -1px;
  }
  .tab.after::after {
    right: -1px;
  }
  .ico {
    display: flex;
    flex-shrink: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .warn {
    display: flex;
    color: var(--accent);
  }
  .x {
    position: relative;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-dim-3);
    cursor: pointer;
  }
  .x :global(svg) {
    opacity: 0;
  }
  .tab:hover .x :global(svg),
  .tab.active .x:not(.dirty) :global(svg) {
    opacity: 1;
  }
  .x:hover {
    background: var(--hover);
    color: var(--text);
  }
  .dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0;
  }
  .x.dirty .dot {
    opacity: 1;
  }
  .tab:hover .x.dirty .dot {
    opacity: 0;
  }
</style>
