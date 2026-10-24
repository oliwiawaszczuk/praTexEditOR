<script lang="ts">
  // Ustawienia › PDF: how a click in the PDF jumps to the code (SyncTeX).
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import { formatKeys, isMac } from "#lib/core/keys.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  const mode = $derived(getSetting<"click" | "mod">("pdf.syncClick", "click"));
  const MODES = [
    { v: "click", label: "klik" },
    { v: "mod", label: isMac() ? "⌘+klik" : "Ctrl+klik" },
  ] as const;
</script>

<div class="wrap">
  <div class="card">
    <div class="row">
      <Icon name="target" size={16} />
      <span class="k">Klik w PDF przenosi do kodu</span>
      <span class="hint">przeciągnięcie dalej zaznacza tekst</span>
      {#if mode !== "click"}
        <button class="icon-btn reset" use:tip={"Przywróć domyślne"} onclick={() => setSetting("pdf.syncClick", "click")}><Icon name="undo" size={13} /></button>
      {:else}
        <span class="reset"></span>
      {/if}
      <div class="seg">
        {#each MODES as m (m.v)}
          <button class:on={mode === m.v} onclick={() => setSetting("pdf.syncClick", m.v)}>{m.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <Icon name="edit" size={16} />
      <span class="k">Kod → PDF</span>
      <span class="hint">{isMac() ? "⌘" : "Ctrl"}+klik w edytorze · {formatKeys(keysOf("sync.toPdf") ?? "mod+j")} · ikona celownika; dodatkowy kursor: {isMac() ? "⌥" : "Alt"}+klik</span>
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
  .seg {
    display: flex;
    border: 1px solid var(--line-3);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    padding: 0 10px;
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
