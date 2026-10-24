<script lang="ts">
  // Ustawienia › Edytor. Applied at once to the visible file (EditorPane reconfigures).
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import { formatKeys } from "#lib/core/keys.ts";
  import { DEFAULT_PREFS } from "#lib/editor/prefs.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import Toggle from "#lib/ui/Toggle.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  const TOGGLES = [
    { key: "editor.wrap", icon: "wrap", label: "Zawijanie wierszy", hint: keysOf("editor.toggleWrap") ?? "alt+z", def: DEFAULT_PREFS.wrap },
    { key: "editor.lineNumbers", icon: "data", label: "Numery wierszy", hint: "", def: DEFAULT_PREFS.lineNumbers },
    { key: "editor.autosave", icon: "disk", label: "Autozapis po chwili bezczynności", hint: "", def: true },
  ] as const;

  const size = $derived(getSetting("editor.fontSize", DEFAULT_PREFS.fontSize));
  const indent = $derived(getSetting("editor.indent", DEFAULT_PREFS.indent));
  const setSize = (v: number) => setSetting("editor.fontSize", Math.min(22, Math.max(10, v)));
</script>

{#snippet reset(key: string, def: unknown, now: unknown)}
  {#if now !== def}
    <button class="icon-btn reset" use:tip={"Przywróć domyślne"} onclick={() => setSetting(key, def)}><Icon name="undo" size={13} /></button>
  {:else}
    <span class="reset"></span>
  {/if}
{/snippet}

<div class="wrap">
  <div class="card">
    {#each TOGGLES as r (r.key)}
      {@const on = getSetting(r.key, r.def)}
      <div class="row">
        <Icon name={r.icon} size={16} />
        <span class="k">{r.label}</span>
        <span class="hint">{r.hint ? formatKeys(r.hint) : ""}</span>
        {@render reset(r.key, r.def, on)}
        <Toggle label={r.label} {on} onchange={(v) => setSetting(r.key, v)} />
      </div>
    {/each}
    <div class="row">
      <Icon name="search" size={16} />
      <span class="k">Wielkość tekstu</span>
      <span class="hint"></span>
      {@render reset("editor.fontSize", DEFAULT_PREFS.fontSize, size)}
      <div class="step">
        <button class="icon-btn" use:tip={"Mniejszy"} onclick={() => setSize(size - 1)}>−</button>
        <span class="val">{size}</span>
        <button class="icon-btn" use:tip={"Większy"} onclick={() => setSize(size + 1)}>+</button>
      </div>
    </div>
    <div class="row">
      <Icon name="layout" size={16} />
      <span class="k">Wcięcie (spacje)</span>
      <span class="hint"></span>
      {@render reset("editor.indent", DEFAULT_PREFS.indent, indent)}
      <div class="seg">
        {#each [2, 4] as n (n)}
          <button class:on={indent === n} onclick={() => setSetting("editor.indent", n)}>{n}</button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .wrap {
    width: min(720px, 100%);
    padding: 28px 32px;
  }
  .card {
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 4px 14px;
    color: var(--text-dim-2);
  }
  .row + .row {
    border-top: 1px solid var(--line-1);
  }
  .k {
    font-size: var(--fs-md);
    color: var(--text);
  }
  .hint {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
  }
  .reset {
    width: 28px;
    flex-shrink: 0;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .val {
    min-width: 26px;
    text-align: center;
    font-size: var(--fs-md);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .seg {
    display: flex;
    border: 1px solid var(--line-3);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    width: 34px;
    height: 24px;
    font-size: var(--fs-sm);
    background: none;
    border: none;
    color: var(--text-dim-2);
    cursor: pointer;
  }
  .seg button + button {
    border-left: 1px solid var(--line-3);
  }
  .seg button.on {
    background: var(--accent-a10);
    color: var(--accent);
  }
</style>
