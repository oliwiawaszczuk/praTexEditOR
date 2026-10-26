<script lang="ts">
  // "Wstaw" bar (docs/03-ux.md §3.2): pictograms of snippet commands, grouped. With a
  // selection they wrap it; without, they insert a skeleton with the cursor in field 1.
  // H▾ / Σ▾ open menus of section levels / math. Toggle: ⌘⇧I.
  import { keysOf, runCommand } from "#lib/core/commands.svelte.ts";
  import { HEADINGS, MATHS, type Snippet } from "#lib/snippets/builtin.ts";
  import { commandId, snippets } from "#lib/snippets/store.svelte.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { toggleSymbols } from "#lib/symbols/palette.svelte.ts";

  const all = $derived(snippets());
  const bar = $derived(all.filter((s) => s.bar && !HEADINGS.includes(s.id) && !MATHS.includes(s.id)));
  const byGroup = $derived([
    bar.filter((s) => s.group === "tekst"),
    bar.filter((s) => s.group === "listy" || s.group === "struktura"),
    bar.filter((s) => s.group === "rysunki"),
    bar.filter((s) => s.group === "odwołania"),
    bar.filter((s) => !["tekst", "listy", "struktura", "rysunki", "odwołania", "matematyka"].includes(s.group)),
  ].filter((g) => g.length));

  function menu(e: MouseEvent, ids: string[]): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items = ids.map((id) => all.find((s) => s.id === id)).filter((s): s is Snippet => !!s);
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, items.map((s) => ({ icon: s.icon, label: s.title, keys: keysOf(commandId(s.id)), run: () => void runCommand(commandId(s.id)) })));
  }

  // Keep the editor's selection: a click on the bar must not take the focus.
  const keep = (e: MouseEvent) => e.preventDefault();
</script>

<div class="bar" role="toolbar" aria-label="Wstaw">
  {#each byGroup as g, i (i)}
    {#if i === 1}
      <button class="ib drop" use:tip={"Sekcje"} onmousedown={keep} onclick={(e) => menu(e, HEADINGS)}><Icon name="heading" size={15} /><Icon name="chevronDown" size={10} /></button>
    {/if}
    {#if i === 2}
      <button class="ib drop" use:tip={"Matematyka"} onmousedown={keep} onclick={(e) => menu(e, MATHS)}><Icon name="sigma" size={15} /><Icon name="chevronDown" size={10} /></button>
    {/if}
    {#if i === 2}
      <button class="ib ib-sym" use:tip={{ label: "Symbole", keys: keysOf("insert.symbols") }} onmousedown={keep} onclick={(e) => toggleSymbols(e.currentTarget as HTMLElement)}><Icon name="omega" size={15} /></button>
    {/if}
    {#each g as s (s.id)}
      <button class="ib" use:tip={{ label: s.title, keys: keysOf(commandId(s.id)) }} onmousedown={keep} onclick={() => runCommand(commandId(s.id))}>
        <Icon name={s.icon} size={15} />
      </button>
    {/each}
    <span class="sep"></span>
  {/each}
</div>

<style>
  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    height: 32px;
    padding: 0 8px;
    background: var(--bg-panel-2);
    border-bottom: 1px solid var(--line-1);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ib {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    height: 24px;
    min-width: 26px;
    padding: 0 5px;
    justify-content: center;
    color: var(--text-dim-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ib:hover {
    color: var(--accent);
    background: var(--hover);
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 5px;
    background: var(--line-2);
  }
  .sep:last-child {
    display: none;
  }
</style>
