<script lang="ts">
  // No project open: cards of all projects (most recent first) + the "new" card.
  // A folder dropped from Finder anywhere here becomes a project.
  import { forgetProject, openProject, projects, PROJECT_COLORS, updateProject, type Project } from "#lib/core/projects.svelte.ts";
  import { call } from "#lib/core/tauri.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import { confirmAction, promptText, showError } from "#lib/ui/dialogs.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { dropTarget } from "#lib/tree/dnd.svelte.ts";
  import ProjectCard from "./ProjectCard.svelte";
  import { openWizard } from "./wizard.svelte.ts";

  let q = $state("");
  let colorFor = $state<{ p: Project; x: number; y: number } | null>(null);

  const list = $derived(projects());
  const shown = $derived(q.trim() ? list.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : list);
  const dropping = $derived(dropTarget() === "@new-project");

  async function open(p: Project): Promise<void> {
    try {
      await openProject(p.id);
    } catch (e) {
      void showError("Nie udało się otworzyć projektu", e);
    }
  }

  function menu(e: MouseEvent, p: Project): void {
    openMenu(e, [
      { icon: "folderOpen", label: "Otwórz", run: () => void open(p) },
      {
        icon: "edit",
        label: "Zmień nazwę",
        run: async () => {
          const n = await promptText("Nazwa projektu", { value: p.name, confirmText: "Zmień" });
          if (n) await updateProject(p.id, { name: n });
        },
      },
      { icon: "palette", label: "Kolor", run: () => (colorFor = { p, x: e.clientX, y: e.clientY }) },
      {
        icon: "reveal",
        label: "Pokaż w Finderze",
        disabled: !p.rootsOk[0],
        run: () => void call("fs_reveal", { pid: p.id, path: p.roots[0] }),
      },
      "sep",
      {
        icon: "trash",
        label: "Usuń z listy",
        danger: true,
        run: async () => {
          const ok = await confirmAction(`Usunąć „${p.name}” z listy?`, "Pliki projektu zostają na dysku.", {
            confirmText: "Usuń z listy",
            danger: true,
          });
          if (ok) await forgetProject(p.id);
        },
      },
    ]);
  }
</script>

<div class="start" data-drop="@new-project" class:dropping>
  <header>
    <img src="/logo.png" alt="" width="34" height="34" />
    <span class="title">Projekty</span>
    <span class="spacer"></span>
    {#if list.length > 4}
      <div class="search">
        <Icon name="search" size={14} />
        <input bind:value={q} placeholder="szukaj…" spellcheck="false" />
      </div>
    {/if}
  </header>

  <div class="grid">
    {#each shown as p (p.id)}
      <ProjectCard {p} onopen={() => open(p)} onmenu={(e) => menu(e, p)} />
    {/each}
    <button class="new" onclick={() => openWizard()} use:tip={"Nowy projekt"}>
      <Icon name="plus" size={36} />
    </button>
  </div>

  {#if !list.length}
    <div class="hint">
      <Icon name="folderOpen" size={18} />
      <span>upuść tu folder z projektem LaTeX</span>
    </div>
  {/if}
</div>

{#if colorFor}
  {@const cf = colorFor}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="pop-back" onclick={() => (colorFor = null)}></div>
  <div class="pop" style:left="{cf.x}px" style:top="{cf.y}px">
    {#each PROJECT_COLORS as c (c)}
      <button
        class="color"
        class:on={c === cf.p.color}
        style:background={c}
        aria-label={c}
        onclick={() => {
          void updateProject(cf.p.id, { color: c });
          colorFor = null;
        }}
      ></button>
    {/each}
  </div>
{/if}

<style>
  .start {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 36px;
    animation: fadein 0.3s ease;
    transition: box-shadow var(--t-fast), background var(--t-fast);
  }
  .start.dropping {
    background: var(--accent-a10);
    box-shadow: inset 0 0 0 2px var(--accent-a40);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 22px;
  }
  .title {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-strong);
  }
  .spacer {
    flex: 1;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    color: var(--text-dim-3);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 16px;
  }
  .search input {
    width: 180px;
    background: none;
    border: none;
    outline: none;
    font-size: var(--fs-md);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 16px;
  }
  .new {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim-3);
    background: transparent;
    border: 2px dashed var(--line-3);
    border-radius: 10px;
    cursor: pointer;
    transition: all var(--t-fast);
  }
  .new:hover {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 40px;
    font-size: var(--fs-md);
    color: var(--text-dim-4);
  }
  .pop-back {
    position: fixed;
    inset: 0;
    z-index: 1090;
  }
  .pop {
    position: fixed;
    z-index: 1100;
    display: flex;
    gap: 8px;
    padding: 10px;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  .color {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .color.on {
    border-color: var(--text-strong);
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }
</style>
