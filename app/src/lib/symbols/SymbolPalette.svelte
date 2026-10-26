<script lang="ts">
  // Symbol palette (docs/02-plan.md "Później"): a popover under the Ω button of the insert
  // bar (⌘⇧Y anywhere in the editor). Glyphs are drawn by KaTeX (loaded on first open); a click
  // inserts the command (wrapped in `$…$` in running text) and the palette stays open for
  // the next symbol. Esc / click outside closes. The editor keeps its focus and selection.
  import { onMount, tick } from "svelte";
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import { editor } from "#lib/editor/bridge.svelte.ts";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { closeSymbols, symbolPalette } from "./palette.svelte.ts";
  import { SYMBOLS, search, type Sym } from "./data.ts";

  const pos = $derived(symbolPalette());
  let tab = $state("greek");
  let query = $state("");
  let input = $state<HTMLInputElement>();
  let katex: typeof import("katex").default | null = $state(null);
  let recent = $state<string[]>(getSetting<string[]>("symbols.recent", []));

  const all = SYMBOLS.flatMap((g) => g.items);
  const byCmd = new Map(all.map((x) => [x.cmd, x]));
  const shown = $derived<Sym[]>(
    query.trim() ? search(query) : tab === "recent" ? recent.map((c) => byCmd.get(c)).filter((x): x is Sym => !!x) : (SYMBOLS.find((g) => g.id === tab)?.items ?? []),
  );

  onMount(async () => {
    const [k] = await Promise.all([import("katex"), import("katex/dist/katex.min.css")]);
    katex = k.default;
  });

  $effect(() => {
    if (pos) void tick().then(() => input?.focus());
    else query = "";
  });

  function glyph(cmd: string): string {
    if (!katex) return "";
    // Placeholders for the empty arguments of \hat{} / \frac{}{}.
    const tex = cmd.replace(/\{\}/g, "{\\square}");
    return katex.renderToString(tex, { throwOnError: false, output: "html" });
  }

  function insert(it: Sym): void {
    const ed = editor();
    if (!ed) return;
    const math = ed.inMath();
    const text = !it.text && !math ? `$${it.cmd}$` : it.cmd;
    ed.insertText(text);
    // `\hat{}` / `\frac{}{}`: cursor into the first pair of braces.
    const hole = text.indexOf("{}");
    if (hole >= 0) ed.moveCursor(hole + 1 - text.length);
    recent = [it.cmd, ...recent.filter((c) => c !== it.cmd)].slice(0, 16);
    setSetting("symbols.recent", recent);
    if (it.pkg) toast(`Wymaga pakietu ${it.pkg}`, { icon: "alert", ms: 1800 });
  }

  function onKey(e: KeyboardEvent): void {
    if (pos && e.key === "Escape") {
      e.stopPropagation();
      closeSymbols();
      document.querySelector<HTMLElement>(".cm-content")?.focus();
    }
  }

  function onDown(e: PointerEvent): void {
    if (pos && !(e.target as HTMLElement).closest(".sympal, .ib-sym")) closeSymbols();
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerdowncapture={onDown} />

{#if pos}
  <div class="sympal" style:left="{Math.min(pos.x, window.innerWidth - 368)}px" style:top="{pos.y}px" role="dialog" aria-label="Symbole">
    <input bind:this={input} bind:value={query} placeholder="Szukaj: alfa, strzałka, \leq…" spellcheck="false" autocomplete="off" />
    {#if !query.trim()}
      <div class="tabs" role="tablist">
        {#if recent.length}
          <button role="tab" aria-selected={tab === "recent"} class:on={tab === "recent"} use:tip={"Ostatnie"} onclick={() => (tab = "recent")}>⟲</button>
        {/if}
        {#each SYMBOLS as g (g.id)}
          <button role="tab" aria-selected={tab === g.id} class:on={tab === g.id} use:tip={g.title} onclick={() => (tab = g.id)}>
            {#if katex}{@html glyph(g.glyph)}{:else}·{/if}
          </button>
        {/each}
      </div>
    {/if}
    <div class="grid" onmousedown={(e) => e.preventDefault()} role="presentation">
      {#each shown as it (it.cmd)}
        <button class="sym" use:tip={it.pkg ? `${it.cmd}  (${it.pkg})` : it.cmd} onclick={() => insert(it)}>
          {#if katex}{@html glyph(it.cmd)}{:else}{it.cmd}{/if}
        </button>
      {:else}
        <p class="none">Brak symboli</p>
      {/each}
    </div>
  </div>
{/if}

<style>
  .sympal {
    position: fixed;
    z-index: 60;
    width: 360px;
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
    .sympal {
      animation: none;
    }
  }
  input {
    height: 28px;
    padding: 0 8px;
    color: var(--text);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: var(--fs-sm);
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .tabs {
    display: flex;
    gap: 2px;
  }
  .tabs button {
    flex: 1;
    height: 28px;
    color: var(--text-dim-2);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--accent);
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
    max-height: 232px;
    overflow-y: auto;
  }
  .sym {
    height: 36px;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 15px;
    overflow: hidden;
  }
  .sym:hover {
    background: var(--hover);
    border-color: var(--accent-a40);
  }
  .none {
    grid-column: 1 / -1;
    margin: 12px 0;
    text-align: center;
    color: var(--text-dim-3);
    font-size: var(--fs-sm);
  }
</style>
