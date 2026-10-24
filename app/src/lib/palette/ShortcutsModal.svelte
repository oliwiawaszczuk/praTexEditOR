<script lang="ts">
  // `?` window: commands grouped, with the keys in force; snippets with their prefixes.
  import { allCommands, keysOf, WHEN_LABEL, type Command } from "#lib/core/commands.svelte.ts";
  import { formatKeys } from "#lib/core/keys.ts";
  import { goTo } from "#lib/core/nav.svelte.ts";
  import { GROUPS } from "#lib/snippets/builtin.ts";
  import { commandId, snippets } from "#lib/snippets/store.svelte.ts";
  import { toText } from "#lib/snippets/vscode.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { closeShortcuts, openShortcuts, shortcutsOpen } from "./shortcuts.svelte.ts";

  const tab = $derived(shortcutsOpen());
  let filter = $state("");

  const groups = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    const cmds = allCommands().filter((c) => c.palette !== false && !c.id.startsWith("snippet.") && keysOf(c.id) && (!f || c.title.toLowerCase().includes(f)));
    const by = new Map<string, Command[]>();
    for (const c of cmds) {
      const g = c.group ?? (c.id.split(".")[0] === "build" ? "Kompilacja" : c.id.startsWith("pdf") || c.id.startsWith("sync") ? "PDF" : c.id.startsWith("tree") ? "Pliki" : "Inne");
      by.set(g, [...(by.get(g) ?? []), c]);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], "pl"));
  });

  const snips = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    return GROUPS.map((g) => ({ g, list: snippets().filter((s) => s.group === g.id && (!f || s.title.toLowerCase().includes(f) || s.prefix.includes(f))) })).filter((x) => x.list.length);
  });

  function onKey(e: KeyboardEvent): void {
    if (tab && e.key === "Escape") {
      e.preventDefault();
      closeShortcuts();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if tab}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={closeShortcuts}>
    <div class="modal" role="dialog" aria-label="Skróty" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <button class="tb" class:on={tab === "keys"} onclick={() => openShortcuts("keys")}><Icon name="keyboard" size={14} /> Skróty</button>
        <button class="tb" class:on={tab === "snippets"} onclick={() => openShortcuts("snippets")}><Icon name="snippet" size={14} /> Snippety</button>
        <input class="input flt" bind:value={filter} placeholder="filtr…" spellcheck="false" />
        <button class="icon-btn" use:tip={"Zmień w Ustawieniach"} onclick={() => { closeShortcuts(); goTo("ustawienia", tab === "keys" ? "skroty" : "snippety"); }}><Icon name="gear" size={15} /></button>
        <button class="icon-btn" use:tip={{ label: "Zamknij", keys: "escape" }} onclick={closeShortcuts}><Icon name="close" size={15} /></button>
      </div>
      <div class="body">
        {#if tab === "keys"}
          <div class="cols">
            {#each groups as [g, cmds] (g)}
              <section>
                <h3>{g}</h3>
                {#each cmds as c (c.id)}
                  <div class="row">
                    <span class="ic"><Icon name={c.icon ?? "keyboard"} size={13} /></span>
                    <span class="t">{c.title}</span>
                    {#if c.when && c.when !== "global"}<span class="ctx">{WHEN_LABEL[c.when]}</span>{/if}
                    <kbd>{formatKeys(keysOf(c.id) ?? "")}</kbd>
                  </div>
                {/each}
              </section>
            {/each}
          </div>
        {:else}
          <p class="note">Wpisz prefiks i naciśnij Tab, albo zacznij od <code>\</code>, żeby zobaczyć listę. Pola: Tab / ⇧Tab, Esc kończy.</p>
          <div class="cols">
            {#each snips as { g, list } (g.id)}
              <section>
                <h3><Icon name={g.icon} size={13} /> {g.label}</h3>
                {#each list as s (s.id)}
                  <div class="row" use:tip={toText(s.body)}>
                    <span class="ic"><Icon name={s.icon} size={13} /></span>
                    <span class="t">{s.title}</span>
                    <code class="pre">{s.prefix}</code>
                    {#if keysOf(commandId(s.id))}<kbd>{formatKeys(keysOf(commandId(s.id)) ?? "")}</kbd>{/if}
                  </div>
                {/each}
              </section>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 880;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--backdrop);
  }
  .modal {
    width: min(980px, 94vw);
    height: min(720px, 88vh);
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 40px var(--backdrop);
    animation: fadein 0.15s ease;
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-2);
  }
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    font-size: var(--fs-md);
    color: var(--text-dim-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tb.on {
    color: var(--accent);
    background: var(--accent-a10);
    border-color: var(--accent-a30);
  }
  .flt {
    margin-left: auto;
    width: 200px;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 14px 18px;
  }
  .cols {
    columns: 2 380px;
    column-gap: 28px;
  }
  section {
    break-inside: avoid;
    margin-bottom: 18px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-dim-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: var(--fs-md);
  }
  .ic {
    display: flex;
    color: var(--text-dim-3);
  }
  .t {
    flex: 1;
    color: var(--text);
  }
  .ctx {
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
  }
  kbd,
  .pre {
    font-family: var(--font);
    font-size: var(--fs-sm);
    padding: 1px 6px;
    border: 1px solid var(--line-3);
    border-radius: 4px;
    color: var(--text-dim-1);
  }
  .pre {
    color: var(--accent);
    border-color: var(--accent-a30);
  }
  .note {
    margin-bottom: 14px;
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
  code {
    font-family: var(--font);
  }
</style>
