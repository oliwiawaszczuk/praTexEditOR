<script lang="ts">
  import { goTo } from "#lib/core/nav.svelte.ts";
  import {
    currentProject,
    forgetProject,
    openProject,
    projects,
    PROJECT_COLORS,
    removeRoot,
    setRoot,
    updateProject,
    type Project,
  } from "#lib/core/projects.svelte.ts";
  import { pickDirectory } from "#lib/core/tauri.ts";
  import { confirmAction, promptText, showError } from "#lib/ui/dialogs.svelte.ts";
  import ColorPicker from "#lib/ui/ColorPicker.svelte";
  import Icon from "#lib/ui/Icon.svelte";
  import { ago } from "#lib/ui/format.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { openWizard } from "#lib/start/wizard.svelte.ts";

  const list = $derived(projects());
  const cur = $derived(currentProject());

  async function run(title: string, f: () => Promise<unknown>): Promise<void> {
    try {
      await f();
    } catch (e) {
      void showError(title, e);
    }
  }

  async function rename(p: Project): Promise<void> {
    const n = await promptText("Nazwa projektu", { value: p.name, confirmText: "Zmień" });
    if (n) await run("Nie udało się zmienić nazwy", () => updateProject(p.id, { name: n }));
  }

  async function addRoot(p: Project): Promise<void> {
    const d = await pickDirectory("Podepnij folder do projektu");
    if (d) await run("Nie udało się podpiąć folderu", () => setRoot(p.id, d));
  }

  async function forget(p: Project): Promise<void> {
    const ok = await confirmAction(`Usunąć „${p.name}” z listy?`, "Pliki projektu zostają na dysku.", { confirmText: "Usuń z listy", danger: true });
    if (ok) await run("Nie udało się usunąć", () => forgetProject(p.id));
  }

  // The picker emits while dragging: one registry write shortly after the last move.
  const recolorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function recolor(p: Project, color: string): void {
    clearTimeout(recolorTimers.get(p.id));
    recolorTimers.set(
      p.id,
      setTimeout(() => {
        recolorTimers.delete(p.id);
        void updateProject(p.id, { color });
      }, 250),
    );
  }
</script>

<div class="wrap">
  <div class="top">
    <button class="btn primary" onclick={() => openWizard()}><Icon name="plus" size={13} /> Nowy projekt</button>
  </div>
  {#each list as p (p.id)}
    <div class="card" class:current={cur?.id === p.id}>
      <div class="head">
        <ColorPicker value={p.color} onchange={(c) => recolor(p, c)} presets={PROJECT_COLORS} label="Kolor projektu" size={16} round />
        <span class="name">{p.name}</span>
        <span class="age">{ago(p.openedAt)}</span>
        <button class="icon-btn" use:tip={"Otwórz"} onclick={() => run("Nie udało się otworzyć", () => openProject(p.id).then(() => goTo("projekt")))}>
          <Icon name="folderOpen" size={15} />
        </button>
        <button class="icon-btn" use:tip={"Zmień nazwę"} onclick={() => rename(p)}><Icon name="edit" size={15} /></button>
        <button class="icon-btn" use:tip={"Podepnij folder"} onclick={() => addRoot(p)}><Icon name="link" size={15} /></button>
        <button class="icon-btn danger" use:tip={"Usuń z listy (pliki zostają)"} onclick={() => forget(p)}><Icon name="trash" size={15} /></button>
      </div>
      {#each p.roots as r, i (r)}
        <div class="root" class:bad={!p.rootsOk[i]}>
          <Icon name={p.rootsOk[i] ? "folder" : "alert"} size={13} />
          <span class="path">{r}</span>
          {#if p.main?.startsWith(r)}
            <span class="main" use:tip={"Plik główny"}><Icon name="star" size={11} />{p.main.slice(r.length + 1)}</span>
          {/if}
          {#if p.roots.length > 1}
            <button class="icon-btn" use:tip={"Odłącz folder"} onclick={() => run("Nie udało się odłączyć", () => removeRoot(p.id, r))}>
              <Icon name="unlink" size={13} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty"><Icon name="project" size={40} /></div>
  {/each}
</div>

<style>
  .wrap {
    width: min(820px, 100%);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top {
    display: flex;
    justify-content: flex-end;
  }
  .card {
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 6px 0;
  }
  .card.current {
    border-color: var(--accent-a30);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 10px 4px 14px;
  }
  .name {
    flex: 1;
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-strong);
  }
  .age {
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
    margin-right: 6px;
  }
  .danger:hover {
    color: var(--danger) !important;
  }
  .root {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px 3px 34px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
  }
  .root.bad {
    color: var(--danger);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    -webkit-user-select: text;
    user-select: text;
  }
  .main {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent);
    font-size: var(--fs-xs);
  }
  .empty {
    display: flex;
    justify-content: center;
    padding: 40px;
    color: var(--text-dim-4);
  }
</style>
