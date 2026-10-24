<script lang="ts">
  // Tab-bar chip of the open project: click → recent projects, all projects, new.
  import { goTo } from "#lib/core/nav.svelte.ts";
  import { closeProject, currentProject, openProject, projects } from "#lib/core/projects.svelte.ts";
  import { openWizard } from "#lib/start/wizard.svelte.ts";
  import { openMenu, type MenuEntry } from "./contextMenu.svelte.ts";
  import { showError } from "./dialogs.svelte.ts";
  import Icon from "./Icon.svelte";

  const p = $derived(currentProject());

  function menu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const recent: MenuEntry[] = projects()
      .filter((x) => x.id !== p?.id)
      .slice(0, 6)
      .map((x) => ({
        icon: "project",
        label: x.name,
        run: () => {
          openProject(x.id).then(() => goTo("projekt"), (err) => showError("Nie udało się otworzyć projektu", err));
        },
      }));
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      ...recent,
      ...(recent.length ? (["sep"] as MenuEntry[]) : []),
      {
        icon: "template",
        label: "Wszystkie projekty",
        run: () => {
          void closeProject().then(() => goTo("projekt"));
        },
      },
      { icon: "plus", label: "Nowy projekt", run: () => openWizard() },
    ]);
  }
</script>

{#if p}
  <button class="chip" style:--c={p.color} onclick={menu}>
    <span class="dot"></span>
    <span class="name">{p.name}</span>
    <Icon name="chevronDown" size={12} />
  </button>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 220px;
    height: 28px;
    padding: 0 10px;
    margin: 0 8px 3px 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
    background: var(--shade);
    border: 1px solid var(--line-2);
    border-radius: 14px;
    cursor: pointer;
    transition: border-color var(--t-fast);
  }
  .chip:hover {
    border-color: color-mix(in srgb, var(--c) 60%, transparent);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
