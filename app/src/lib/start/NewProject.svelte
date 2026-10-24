<script lang="ts">
  // New project: three big tiles (template / folder / zip), then one small step.
  import { onMount, tick } from "svelte";
  import { call } from "#lib/core/tauri.ts";
  import ColorPicker from "#lib/ui/ColorPicker.svelte";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import {
    baseName,
    createFromFolders,
    createFromTemplate,
    defaultParentDir,
    nextColor,
    PROJECT_COLORS,
    templatesList,
    unzipProject,
    type MainCandidate,
    type TemplateInfo,
  } from "#lib/core/projects.svelte.ts";
  import { pickDirectory } from "#lib/core/tauri.ts";
  import { showError } from "#lib/ui/dialogs.svelte.ts";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { closeWizard, finishProject, folderFlow, setWizard, wizard, zipFlow } from "./wizard.svelte.ts";

  const w = $derived(wizard());

  let templates = $state<TemplateInfo[]>([]);

  function dropTemplate(e: MouseEvent, t: TemplateInfo): void {
    e.preventDefault();
    openMenu({ clientX: e.clientX, clientY: e.clientY }, [
      {
        icon: "trash",
        label: "Usuń szablon",
        danger: true,
        run: async () => {
          await call("template_delete", { id: t.id });
          templates = templates.filter((x) => x.id !== t.id);
          if (tpl === t.id) tpl = templates[0]?.id ?? "";
        },
      },
    ]);
  }
  let tpl = $state("raport");
  let name = $state("");
  let parent = $state("");
  let color = $state(nextColor());
  let busy = $state(false);
  let nameInput = $state<HTMLInputElement>();

  onMount(async () => {
    templates = await templatesList().catch(() => []);
    parent = await defaultParentDir().catch(() => "");
  });

  // Entering a step that asks for a name: prefill + focus.
  let lastStep = "";
  $effect(() => {
    const step = w?.step ?? "";
    if (step === lastStep) return;
    lastStep = step;
    if (step === "template") {
      name = "";
      // Own templates change in Ustawienia › Szablony: reload on every visit.
      void templatesList()
        .then((l) => {
          templates = l;
          if (!l.some((t) => t.id === tpl)) tpl = l[0]?.id ?? "";
        })
        .catch(() => {});
    }
    if (step === "zip") name = w?.name ?? "";
    color = nextColor();
    if (step === "template" || step === "zip") void tick().then(() => nameInput?.focus());
  });

  async function pickParent(): Promise<void> {
    const d = await pickDirectory("Gdzie utworzyć folder projektu?");
    if (d) parent = d;
  }

  async function createTemplate(): Promise<void> {
    if (!name.trim() || !parent || busy) return;
    busy = true;
    try {
      const p = await createFromTemplate(tpl, name.trim(), parent, color);
      await finishProject(p.id);
    } catch (e) {
      void showError("Nie udało się utworzyć projektu", e);
    } finally {
      busy = false;
    }
  }

  async function createZip(): Promise<void> {
    if (!w?.path || !name.trim() || !parent || busy) return;
    busy = true;
    try {
      const u = await unzipProject(w.path, parent, name.trim());
      if (u.candidates.length > 1) setWizard({ step: "main", path: u.dir, name: baseName(u.dir), candidates: u.candidates });
      else {
        const p = await createFromFolders(baseName(u.dir), [u.dir], u.candidates[0]?.path ?? null, color);
        await finishProject(p.id);
      }
    } catch (e) {
      void showError("Nie udało się rozpakować", e);
    } finally {
      busy = false;
    }
  }

  async function chooseMain(c: MainCandidate | null): Promise<void> {
    if (!w?.path || busy) return;
    busy = true;
    try {
      const p = await createFromFolders(w.name ?? baseName(w.path), [w.path], c?.path ?? null, color);
      await finishProject(p.id);
    } catch (e) {
      void showError("Nie udało się utworzyć projektu", e);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (!w) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (w.step === "pick" || w.step === "main") closeWizard();
      else setWizard({ step: "pick" });
    } else if (e.key === "Enter" && !e.isComposing) {
      if (w.step === "template") void createTemplate();
      else if (w.step === "zip") void createZip();
    }
  }

  const TILES: { icon: IconName; label: string; run: () => void }[] = [
    { icon: "template", label: "Szablon", run: () => setWizard({ step: "template" }) },
    { icon: "folderOpen", label: "Folder", run: () => void folderFlow() },
    { icon: "zip", label: "ZIP", run: () => void zipFlow() },
  ];
</script>

<svelte:window onkeydown={onKey} />

{#snippet place()}
  <div class="row">
    <span class="k"><Icon name="folder" size={15} /></span>
    <button class="loc" use:tip={"Zmień miejsce"} onclick={pickParent}>
      <span>{parent || "wybierz folder…"}</span>
    </button>
  </div>
  <div class="row">
    <span class="k"><Icon name="palette" size={15} /></span>
    <div class="colors">
      {#each PROJECT_COLORS as c (c)}
        <button class="color" class:on={c === color} style:background={c} aria-label={c} onclick={() => (color = c)}></button>
      {/each}
      <ColorPicker value={color} onchange={(c) => (color = c)} presets={PROJECT_COLORS} label="Własny kolor" size={18} round />
    </div>
  </div>
{/snippet}

{#if w}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={closeWizard}>
    <div class="modal" class:wide={w.step === "template"} onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      {#if w.step !== "pick"}
        <button class="icon-btn back" use:tip={{ label: "Wstecz", keys: "escape" }} onclick={() => setWizard({ step: "pick" })}>
          <Icon name="arrowLeft" size={16} />
        </button>
      {/if}
      <button class="icon-btn close" use:tip={"Zamknij"} onclick={closeWizard}><Icon name="close" size={16} /></button>

      {#if w.step === "pick"}
        <div class="tiles">
          {#each TILES as t (t.label)}
            <button class="tile" onclick={t.run}>
              <Icon name={t.icon} size={40} />
              <span>{t.label}</span>
            </button>
          {/each}
        </div>
      {:else if w.step === "template"}
        <div class="tpls">
          {#each templates as t (t.id)}
            <button class="tpl" class:on={t.id === tpl} onclick={() => (tpl = t.id)} ondblclick={createTemplate} oncontextmenu={(e) => t.custom && dropTemplate(e, t)} use:tip={t.files.join(" · ")}>
              <Icon name={t.icon as IconName} size={30} />
              <span>{t.name}</span>
            </button>
          {/each}
        </div>
        <div class="form">
          <input class="input big" bind:this={nameInput} bind:value={name} placeholder="nazwa projektu" spellcheck="false" />
          {@render place()}
          <button class="btn primary go" disabled={!name.trim() || !parent || busy} onclick={createTemplate}>
            <Icon name="check" size={14} /> Utwórz
          </button>
        </div>
      {:else if w.step === "zip"}
        <div class="head"><Icon name="zip" size={28} /><span class="file">{baseName(w.path ?? "")}</span></div>
        <div class="form">
          <input class="input big" bind:this={nameInput} bind:value={name} placeholder="nazwa folderu" spellcheck="false" />
          {@render place()}
          <button class="btn primary go" disabled={!name.trim() || !parent || busy} onclick={createZip}>
            <Icon name="download" size={14} /> Rozpakuj
          </button>
        </div>
      {:else if w.step === "main"}
        <div class="head"><Icon name="star" size={24} /><span class="file">Który plik jest główny?</span></div>
        <div class="mains">
          {#each w.candidates ?? [] as c (c.path)}
            <button class="main" disabled={busy} onclick={() => chooseMain(c)}>
              <span class="ico"><Icon name="tex" size={18} /></span>
              <span class="rel">{c.rel}</span>
              <span class="pre">{c.preview.join("  ")}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--backdrop);
    animation: fade 0.12s ease;
  }
  .modal {
    position: relative;
    width: min(560px, calc(100vw - 32px));
    padding: 34px 26px 24px;
    background: var(--bg-panel);
    border: 1px solid var(--line-2);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    animation: pop 0.16s ease;
  }
  .modal.wide {
    width: min(720px, calc(100vw - 32px));
  }
  .back {
    position: absolute;
    top: 8px;
    left: 8px;
  }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 10px 22px;
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-dim-1);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 10px;
    cursor: pointer;
    transition: all var(--t-fast);
  }
  .tile:hover {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--accent-a10);
    transform: translateY(-2px);
  }
  .tpls {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
    margin-bottom: 18px;
  }
  .tpl {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 18px 6px 14px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 10px;
    cursor: pointer;
    transition: all var(--t-fast);
  }
  .tpl:hover {
    color: var(--text);
  }
  .tpl.on {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .big {
    font-size: var(--fs-lg);
    padding: 9px 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .k {
    display: flex;
    color: var(--text-dim-3);
  }
  .loc {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    font-size: var(--fs-sm);
    color: var(--text-dim-1);
    text-align: left;
    background: var(--bg-deep);
    border: 1px dashed var(--line-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .loc span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .loc:hover {
    border-color: var(--accent-a40);
  }
  .colors {
    display: flex;
    gap: 8px;
  }
  .color {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform var(--t-fast);
  }
  .color:hover {
    transform: scale(1.15);
  }
  .color.on {
    border-color: var(--text-strong);
    box-shadow: 0 0 0 2px var(--bg-panel) inset;
  }
  .go {
    align-self: flex-end;
    margin-top: 4px;
    padding: 7px 16px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    color: var(--accent);
  }
  .file {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mains {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 50vh;
    overflow-y: auto;
  }
  .main {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    padding: 9px 12px;
    text-align: left;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .main:hover {
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .main .ico {
    grid-row: span 2;
    display: flex;
    align-items: center;
    color: var(--file-tex);
  }
  .rel {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-strong);
  }
  .pre {
    font-size: var(--fs-xs);
    color: var(--text-dim-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
</style>
