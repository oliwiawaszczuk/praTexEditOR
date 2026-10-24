<script lang="ts">
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import Toggle from "#lib/ui/Toggle.svelte";

  const ROWS = [
    { key: "tree.showAux", icon: "file", label: "Pliki pomocnicze TeX w drzewie", hint: ".aux .log .toc .bbl …" },
    { key: "tree.showHidden", icon: "search", label: "Ukryte pliki w drzewie", hint: ".latexmkrc, .gitignore …" },
    { key: "openLastProject", icon: "project", label: "Otwieraj ostatni projekt przy starcie", hint: "", def: true },
  ] as const;
</script>

<div class="wrap">
  <div class="card">
    {#each ROWS as r (r.key)}
      {@const def = "def" in r ? r.def : false}
      <div class="row">
        <Icon name={r.icon} size={16} />
        <span class="k">{r.label}</span>
        <span class="hint">{r.hint}</span>
        <Toggle label={r.label} on={getSetting(r.key, def)} onchange={(v) => setSetting(r.key, v)} />
      </div>
    {/each}
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
</style>
