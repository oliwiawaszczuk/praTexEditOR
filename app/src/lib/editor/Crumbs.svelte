<script lang="ts">
  // Breadcrumbs (docs/03-ux.md §3.2): where in the document the cursor is,
  // `Rozdział › Podrozdział ▾`, plus the word count. A crumb opens its siblings (also in
  // other files); the outline follows the include graph, so order = print order.
  import { onMount } from "svelte";
  import { activeIndex, type OutlineItem } from "#lib/index/index.svelte.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import type { Docs } from "./docs.svelte.ts";

  let { docs }: { docs: Docs } = $props();

  const index = $derived(activeIndex());
  const path = $derived(docs.active?.path ?? "");
  let line = $state(1);

  onMount(() => {
    line = docs.cursor()?.line ?? 1;
    return docs.onCursor((c) => {
      if (c.path === path) line = c.line;
    });
  });
  // Another tab: its own cursor line (0 → start of the file).
  $effect(() => {
    void path;
    line = docs.cursor()?.line ?? 1;
  });

  const crumbs = $derived(index?.crumbs(path, line) ?? []);
  const words = $derived(index?.snap.fileWords[path] ?? 0);
  const total = $derived(index?.snap.words ?? 0);
  const fmt = (n: number) => n.toLocaleString("pl-PL");

  async function go(o: OutlineItem): Promise<void> {
    await docs.reveal(o.file, o.line);
  }

  function pick(e: MouseEvent, c: OutlineItem): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sib = index?.siblings(c) ?? [c];
    openMenu(
      { clientX: r.left, clientY: r.bottom + 4 },
      sib.map((o) => ({ icon: o === c ? ("check" as const) : ("heading" as const), label: o.title || "(bez tytułu)", run: () => void go(o) })),
    );
  }
</script>

{#if index?.loaded && (crumbs.length || words)}
  <div class="crumbs">
    {#each crumbs as c, i (c.file + c.line)}
      {#if i}<span class="sep"><Icon name="chevronRight" size={11} /></span>{/if}
      <button class="crumb" class:last={i === crumbs.length - 1} onclick={(e) => pick(e, c)}>{c.title || "(bez tytułu)"}<Icon name="chevronDown" size={10} /></button>
    {/each}
    <span class="grow"></span>
    {#if words}
      <span class="words" use:tip={`W pliku: ${fmt(words)} słów · w dokumencie: ${fmt(total)}`}>{fmt(words)} słów</span>
    {/if}
  </div>
{/if}

<style>
  .crumbs {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    padding: 0 10px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--line-1);
    overflow: hidden;
    white-space: nowrap;
  }
  .sep {
    display: flex;
    color: var(--text-dim-4);
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 240px;
    height: 20px;
    padding: 0 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .crumb:hover {
    color: var(--text);
    background: var(--hover);
  }
  .crumb.last {
    color: var(--text);
  }
  .grow {
    flex: 1;
  }
  .words {
    color: var(--text-dim-3);
    cursor: default;
  }
</style>
