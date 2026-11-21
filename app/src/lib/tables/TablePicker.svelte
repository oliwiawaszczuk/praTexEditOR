<script lang="ts">
  // Table generator: a popover under the table button of the insert bar (⌘⌥T anywhere in the
  // editor). Hover the grid for the size, click inserts (arrows + Enter from the keyboard).
  // A selection copied from a spreadsheet / CSV can be turned into a table instead. Style
  // (rules, alignment, header, float) is remembered globally. Esc / click outside closes.
  import { tick, untrack } from "svelte";
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { ensurePackages } from "#lib/snippets/requires.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { closeTable, tablePicker } from "./picker.svelte.ts";
  import { DEFAULT_OPTS, MAX_COLS, MAX_ROWS, parseCells, requiresOf, tableSnippet, type Align, type Borders, type TableOpts } from "./table.ts";

  const BORDERS: { v: Borders; icon: IconName; label: string }[] = [
    { v: "booktabs", icon: "tableBooktabs", label: "Linie książkowe (booktabs)" },
    { v: "rows", icon: "tableRows", label: "Linie między wierszami" },
    { v: "grid", icon: "table", label: "Pełna siatka" },
    { v: "none", icon: "tableNone", label: "Bez linii" },
  ];
  const ALIGNS: { v: Align; icon: IconName; label: string }[] = [
    { v: "l", icon: "alignLeft", label: "Do lewej" },
    { v: "c", icon: "alignCenter", label: "Do środka" },
    { v: "r", icon: "alignRight", label: "Do prawej" },
  ];

  const pos = $derived(tablePicker());
  let opts = $state<TableOpts>({ ...DEFAULT_OPTS, ...getSetting<Partial<TableOpts>>("table.opts", {}) });
  let rows = $state(3);
  let cols = $state(3);
  let cells = $state<string[][] | null>(null);
  let hasSel = $state(false);
  let grid = $state<HTMLDivElement>();

  $effect(() => {
    if (!pos) return;
    untrack(() => {
      const sel = editor()?.selection();
      hasSel = !!sel;
      cells = sel ? parseCells(sel.text) : null;
    });
    void tick().then(() => grid?.focus());
  });

  function set<K extends keyof TableOpts>(k: K, v: TableOpts[K]): void {
    opts[k] = v;
    setSetting("table.opts", $state.snapshot(opts));
  }

  function insert(fromSel: boolean): void {
    const ed = editor();
    if (!ed) return;
    const body = fromSel && cells ? tableSnippet(0, 0, opts, cells) : tableSnippet(rows, cols, opts, undefined, hasSel);
    closeTable();
    if (ed.insertSnippet(body)) void ensurePackages(requiresOf(opts));
  }

  function onKey(e: KeyboardEvent): void {
    if (!pos) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeTable();
      document.querySelector<HTMLElement>(".cm-content")?.focus();
      return;
    }
    if (e.target !== grid) return;
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const d = move[e.key];
    if (d) {
      rows = Math.min(MAX_ROWS, Math.max(1, rows + d[0]));
      cols = Math.min(MAX_COLS, Math.max(1, cols + d[1]));
    } else if (e.key === "Enter") {
      insert(false);
    } else return;
    // The app's key dispatcher must not see these (arrows would move the editor cursor).
    e.preventDefault();
    e.stopPropagation();
  }

  function onDown(e: PointerEvent): void {
    if (pos && !(e.target as HTMLElement).closest(".tabpick, .ib-tab")) closeTable();
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerdowncapture={onDown} />

{#if pos}
  <div class="tabpick" style:left="{Math.min(pos.x, window.innerWidth - 248)}px" style:top="{pos.y}px" role="dialog" aria-label="Generator tabel">
    {#if cells}
      <button class="fromsel" onclick={() => insert(true)}>
        <Icon name="table" size={14} />
        <span>Zamień zaznaczenie w tabelę</span>
        <span class="dim">{cells.length} × {cells[0].length}</span>
      </button>
    {/if}
    <div class="size">{rows} × {cols}</div>
    <div
      class="grid"
      bind:this={grid}
      tabindex="0"
      role="grid"
      aria-label="Rozmiar tabeli: {rows} wierszy, {cols} kolumn"
      style:grid-template-columns="repeat({MAX_COLS}, 1fr)"
    >
      {#each { length: MAX_ROWS } as _, r (r)}
        {#each { length: MAX_COLS } as _, c (c)}
          <button
            class="cell"
            class:on={r < rows && c < cols}
            class:head={opts.header && r === 0 && c < cols}
            tabindex="-1"
            aria-label="{r + 1} × {c + 1}"
            onpointerenter={() => ((rows = r + 1), (cols = c + 1))}
            onclick={() => insert(false)}
          ></button>
        {/each}
      {/each}
    </div>
    <div class="opts">
      <div class="seg" role="radiogroup" aria-label="Linie">
        {#each BORDERS as b (b.v)}
          <button role="radio" aria-checked={opts.borders === b.v} class:on={opts.borders === b.v} use:tip={b.label} onclick={() => set("borders", b.v)}><Icon name={b.icon} size={14} /></button>
        {/each}
      </div>
      <div class="seg" role="radiogroup" aria-label="Wyrównanie">
        {#each ALIGNS as a (a.v)}
          <button role="radio" aria-checked={opts.align === a.v} class:on={opts.align === a.v} use:tip={a.label} onclick={() => set("align", a.v)}><Icon name={a.icon} size={14} /></button>
        {/each}
      </div>
    </div>
    <div class="opts">
      <button class="tog" aria-pressed={opts.header} class:on={opts.header} use:tip={"Pierwszy wiersz to nagłówek"} onclick={() => set("header", !opts.header)}><Icon name="tableHeader" size={14} /></button>
      <button class="tog" aria-pressed={opts.float} class:on={opts.float} use:tip={"W otoczeniu table z podpisem i etykietą"} onclick={() => set("float", !opts.float)}><Icon name="caption" size={14} /></button>
    </div>
  </div>
{/if}

<style>
  .tabpick {
    position: fixed;
    z-index: 60;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    animation: pop 0.12s ease;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tabpick {
      animation: none;
    }
  }
  .fromsel {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    color: var(--text);
    background: var(--bg-deep);
    border: 1px solid var(--accent-a40);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .fromsel:hover {
    border-color: var(--accent);
  }
  .fromsel .dim {
    margin-left: auto;
    color: var(--text-dim-2);
  }
  .size {
    text-align: center;
    color: var(--text-dim-2);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .grid {
    display: grid;
    gap: 3px;
    padding: 2px;
    border-radius: var(--radius-sm);
    outline: none;
  }
  .grid:focus-visible {
    box-shadow: 0 0 0 1px var(--accent-a40);
  }
  .cell {
    aspect-ratio: 1;
    padding: 0;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 2px;
    cursor: pointer;
  }
  .cell.on {
    background: var(--accent-a40);
    border-color: var(--accent);
  }
  .cell.on.head {
    background: var(--accent);
  }
  .opts {
    display: flex;
    gap: 6px;
  }
  .seg {
    display: flex;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button,
  .tog {
    width: 28px;
    height: 26px;
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--text-dim-2);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .tog {
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }
  .seg button:hover,
  .tog:hover {
    color: var(--accent);
  }
  .seg button.on,
  .tog.on {
    color: var(--accent);
    background: var(--hover);
  }
</style>
