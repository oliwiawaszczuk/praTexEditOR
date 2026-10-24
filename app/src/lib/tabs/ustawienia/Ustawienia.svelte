<script lang="ts">
  // Settings: icon list of sections on the left, content on the right (docs/03-ux.md §7).
  // Every change saves immediately — there is no "Save" button anywhere.
  import { openSection, settingsSection, type SettingsSection } from "#lib/core/nav.svelte.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import Placeholder from "../Placeholder.svelte";
  import Diagnostics from "./Diagnostics.svelte";
  import Edytor from "./Edytor.svelte";
  import Kompilacja from "./Kompilacja.svelte";
  import Pdf from "./Pdf.svelte";
  import Skroty from "./Skroty.svelte";
  import Snippety from "./Snippety.svelte";
  import Szablony from "./Szablony.svelte";
  import Ogolne from "./Ogolne.svelte";
  import Projekty from "./Projekty.svelte";

  type Key = SettingsSection;

  const SECTIONS: { key: Key; label: string; icon: IconName; stage?: string }[] = [
    { key: "ogolne", label: "Ogólne", icon: "gear" },
    { key: "edytor", label: "Edytor", icon: "edit" },
    { key: "kompilacja", label: "Kompilacja", icon: "engine" },
    { key: "pdf", label: "PDF", icon: "pdf" },
    { key: "skroty", label: "Skróty", icon: "keyboard" },
    { key: "snippety", label: "Snippety", icon: "snippet" },
    { key: "szablony", label: "Szablony", icon: "template" },
    { key: "projekty", label: "Projekty", icon: "project" },
    { key: "info", label: "O aplikacji", icon: "info" },
  ];

  const active = $derived(settingsSection());
  const current = $derived(SECTIONS.find((s) => s.key === active) ?? SECTIONS[SECTIONS.length - 1]);
</script>

<div class="settings">
  <nav class="side">
    {#each SECTIONS as s (s.key)}
      <button class="item" class:active={s.key === active} onclick={() => openSection(s.key)}>
        <Icon name={s.icon} size={16} />
        <span class="lbl">{s.label}</span>
        {#if s.stage}<span class="badge">{s.stage}</span>{/if}
      </button>
    {/each}
  </nav>
  <section class="body">
    {#if current.key === "info"}
      <Diagnostics />
    {:else if current.key === "ogolne"}
      <Ogolne />
    {:else if current.key === "edytor"}
      <Edytor />
    {:else if current.key === "kompilacja"}
      <Kompilacja />
    {:else if current.key === "skroty"}
      <Skroty />
    {:else if current.key === "snippety"}
      <Snippety />
    {:else if current.key === "szablony"}
      <Szablony />
    {:else if current.key === "pdf"}
      <Pdf />
    {:else if current.key === "projekty"}
      <Projekty />
    {:else}
      <Placeholder icon={current.icon} title={current.label} stage="etap {current.stage}" />
    {/if}
  </section>
</div>

<style>
  .settings {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .side {
    width: 210px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px;
    background: var(--bg-panel-2);
    border-right: 1px solid var(--line-1);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    font-size: var(--fs-md);
    color: var(--text-dim-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .item:hover:not(.active) {
    background: var(--hover);
    color: var(--text);
  }
  .item.active {
    color: var(--accent);
    background: var(--accent-a10);
    border-color: var(--accent-a30);
  }
  .lbl {
    flex: 1;
  }
  .badge {
    font-size: 0.6rem;
    color: var(--text-dim-4);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow: auto;
  }
</style>
