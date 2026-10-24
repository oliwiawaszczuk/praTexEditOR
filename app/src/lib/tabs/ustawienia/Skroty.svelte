<script lang="ts">
  // Ustawienia › Skróty (docs/03-ux.md §7): every command with its shortcut; click the
  // chip to record. The filter takes a name, or a pressed shortcut (shows what is
  // under ⌘B). Import from VS Code keybindings.json.
  import { allCommands, command, getOverrides, keysOf, strokeOf, WHEN_LABEL, type Command } from "#lib/core/commands.svelte.ts";
  import { bind, bindMany, importVsCode, resetAll } from "#lib/core/keybindings.ts";
  import { formatKeys, isMac } from "#lib/core/keys.ts";
  import { currentProject } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import { confirmAction } from "#lib/ui/dialogs.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import KeyRecorder from "#lib/ui/KeyRecorder.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  let text = $state("");
  let byKey = $state<string | null>(null);

  const groupOf = (c: Command) =>
    c.group ?? (c.id.startsWith("build.") ? "Kompilacja" : c.id.startsWith("pdf.") || c.id.startsWith("sync.") ? "PDF" : c.id.startsWith("tree.") ? "Pliki" : c.id.startsWith("tab.") ? "Karty" : "Inne");

  const groups = $derived.by(() => {
    const f = text.trim().toLowerCase();
    const list = allCommands()
      .filter((c) => c.palette !== false || c.keys)
      .filter((c) => !f || c.title.toLowerCase().includes(f) || c.id.includes(f))
      .filter((c) => !byKey || (keysOf(c.id) ?? "").toLowerCase() === byKey || (keysOf(c.id) ?? "").toLowerCase().startsWith(byKey + " "));
    const by = new Map<string, Command[]>();
    for (const c of list) by.set(groupOf(c), [...(by.get(groupOf(c)) ?? []), c]);
    for (const l of by.values()) l.sort((a, b) => a.title.localeCompare(b.title, "pl"));
    return [...by.entries()].sort((a, b) => (a[0] === "Wstaw" ? 1 : b[0] === "Wstaw" ? -1 : a[0].localeCompare(b[0], "pl")));
  });
  const changed = $derived(Object.keys(getOverrides()).length);

  /** In the filter: a key with a modifier (or F-key) filters by shortcut. */
  function filterKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key);
    if (!mod) return;
    const s = strokeOf(e, isMac());
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    byKey = s;
    text = "";
  }

  async function importFile(): Promise<void> {
    try {
      const json = await call<unknown>("import_json_file", { title: "keybindings.json z VS Code" });
      if (json === null) return;
      const { changes, skipped } = importVsCode(json, (id) => !!command(id));
      const n = Object.keys(changes).length;
      if (n) await bindMany(changes);
      toast(`Zaimportowano ${n} skrótów${skipped ? `, pominięto ${skipped} nieznanych` : ""}`, { icon: "keyboard" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    }
  }

  async function reset(): Promise<void> {
    if (await confirmAction("Przywrócić domyślne skróty?", `Zmienione: ${changed}.`, { confirmText: "Przywróć", danger: true })) await resetAll();
  }
</script>

<div class="wrap">
  <div class="top">
    <div class="flt">
      <Icon name="search" size={14} />
      {#if byKey}
        <button class="keychip" use:tip={"Wyczyść"} onclick={() => (byKey = null)}>{formatKeys(byKey)} <Icon name="close" size={11} /></button>
      {/if}
      <input bind:value={text} onkeydown={filterKey} placeholder={byKey ? "" : "filtr: nazwa albo naciśnij skrót"} spellcheck="false" />
    </div>
    <button class="btn" use:tip={"Import keybindings.json z VS Code"} onclick={() => void importFile()}><Icon name="download" size={14} /> VS Code</button>
    <button class="icon-btn" disabled={!changed} use:tip={"Przywróć wszystkie domyślne"} onclick={() => void reset()}><Icon name="undo" size={15} /></button>
  </div>
  {#if !currentProject()}
    <p class="note"><Icon name="info" size={13} /> Komendy edytora, PDF i drzewa pojawią się, gdy otworzysz projekt.</p>
  {/if}

  {#each groups as [g, cmds] (g)}
    <h3>{g}</h3>
    <div class="card">
      {#each cmds as c (c.id)}
        <div class="row">
          <span class="ic"><Icon name={c.icon ?? "keyboard"} size={15} /></span>
          <span class="k">{c.title}</span>
          <span class="ctx">{WHEN_LABEL[c.when ?? "global"]}</span>
          {#if c.id in getOverrides()}
            <button class="icon-btn reset" use:tip={c.keys ? `Domyślnie: ${formatKeys(c.keys)}` : "Domyślnie bez skrótu"} onclick={() => void bind(c.id, null)}><Icon name="undo" size={13} /></button>
          {:else}
            <span class="reset"></span>
          {/if}
          <KeyRecorder id={c.id} when={c.when ?? "global"} />
        </div>
      {/each}
    </div>
  {:else}
    <p class="note">Nic nie pasuje.</p>
  {/each}
</div>

<style>
  .wrap {
    width: min(860px, 100%);
    padding: 24px 32px 40px;
    overflow: auto;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .flt {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    color: var(--text-dim-3);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }
  .flt:focus-within {
    border-color: var(--accent-a40);
  }
  .flt input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--fs-md);
  }
  .keychip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    font-family: var(--font);
    font-size: var(--fs-sm);
    color: var(--accent);
    background: var(--accent-a10);
    border: 1px solid var(--accent-a30);
    border-radius: 5px;
    cursor: pointer;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  h3 {
    margin: 20px 0 8px;
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-dim-2);
  }
  .card {
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 2px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 4px 14px;
  }
  .row + .row {
    border-top: 1px solid var(--line-1);
  }
  .ic {
    display: flex;
    color: var(--text-dim-3);
  }
  .k {
    flex: 1;
    font-size: var(--fs-md);
    color: var(--text);
  }
  .ctx {
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
  }
  .reset {
    width: 28px;
    flex-shrink: 0;
  }
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0;
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
</style>
