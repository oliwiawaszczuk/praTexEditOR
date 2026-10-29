<script lang="ts">
  // "Wersje" — version control of the open project: what changed (like `git status`, but
  // clickable), a green/red diff, history, and comparison with any commit or the files
  // on disk. Everything is local; the work happens in Rust (git/).
  import { keysOf } from "#lib/core/commands.svelte.ts";
  import { currentProject } from "#lib/core/projects.svelte.ts";
  import { activeGit } from "#lib/git/git.svelte.ts";
  import { openMenu } from "#lib/ui/contextMenu.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import Splitter from "../projekt/Splitter.svelte";
  import ChangesPane from "./ChangesPane.svelte";
  import DiffView from "./DiffView.svelte";
  import HistoryPane from "./HistoryPane.svelte";

  const project = $derived(currentProject());
  const git = $derived(activeGit());

  const MIN = 280;
  const MAX = 620;
  let width = $state(Math.min(MAX, Math.max(MIN, getSetting<number>("gitLeft", 350))));
  let drag = $state<number | null>(null);
  let start = 0;
  const w = $derived(drag ?? width);

  function pickRepo(e: MouseEvent): void {
    if (!git) return;
    openMenu(
      e,
      git.repos.map((r) => ({
        icon: "folder" as const,
        label: `${r.root === git.root ? "● " : ""}${r.name}${r.isRepo ? "" : " (bez repozytorium)"}`,
        run: () => git.setRoot(r.root),
      })),
    );
  }
</script>

<div class="git-tab">
  {#if !project}
    <div class="center">
      <Icon name="branch" size={40} />
      <b>Otwórz projekt, aby zobaczyć jego wersje</b>
      <span>Historia, zmiany i porównania pojawią się tutaj.</span>
    </div>
  {:else if !git || !git.loaded}
    <div class="center dim"><span>Ładowanie…</span></div>
  {:else if git.error && !git.repos.length}
    <div class="center"><Icon name="alert" size={34} /><span>{git.error}</span></div>
  {:else if !git.repo?.isRepo}
    <div class="center">
      <span class="hero"><Icon name="branch" size={34} /></span>
      <b>Ten folder nie ma jeszcze wersjonowania</b>
      <span class="sub">Git zapamięta każdą wersję Twojej pracy — zobaczysz, co i kiedy się zmieniło, i wrócisz do dowolnego momentu. Wszystko zostaje na tym komputerze.</span>
      <button class="primary" onclick={() => git.repo && void git.init(git.repo.root)}>
        <Icon name="commit" size={15} /> Zacznij wersjonować „{git.repo?.name}”
      </button>
      {#if git.repos.length > 1}
        <button class="ghost" onclick={pickRepo}><Icon name="folder" size={14} /> Wybierz inny folder projektu</button>
      {/if}
    </div>
  {:else}
    <header>
      {#if git.repos.length > 1}
        <button class="chip" use:tip={"Zmień folder projektu"} onclick={pickRepo}>
          <Icon name="folder" size={13} /><span>{git.repo.name}</span><Icon name="chevronDown" size={11} />
        </button>
      {/if}
      <span class="chip static" use:tip={git.repo.detached ? "Odłączony HEAD" : "Bieżąca gałąź"}>
        <Icon name="branch" size={13} />
        <b>{git.repo.branch ?? "—"}</b>
        {#if git.repo.head}<code>{git.repo.head}</code>{/if}
      </span>
      {#if git.repo.repoRoot}
        <span class="chip static" use:tip={`Repozytorium Git jest w folderze nadrzędnym: ${git.repo.repoRoot}. Pokazuję tylko zmiany z tego projektu.`}>
          <Icon name="folderOpen" size={13} /><span>repozytorium wyżej: {git.repo.repoRoot.split(/[\\/]/).pop()}</span>
        </span>
      {/if}
      <span class="seg" role="tablist">
        <button role="tab" aria-selected={git.view === "changes"} class:on={git.view === "changes"} onclick={() => git.setView("changes")}>
          <Icon name="compare" size={14} /><span>Zmiany</span>{#if git.dirty}<i>{git.dirty}</i>{/if}
        </button>
        <button role="tab" aria-selected={git.view === "history"} class:on={git.view === "history"} onclick={() => git.setView("history")}>
          <Icon name="history" size={14} /><span>Historia</span>
        </button>
      </span>
      <span class="spacer"></span>
      <button class="ib" use:tip={{ label: "Odśwież", keys: keysOf("app.git.refresh") }} onclick={() => void git.refresh()}><Icon name="refresh" size={15} /></button>
    </header>
    <div class="body">
      <aside style:width="{w}px">
        {#if git.view === "changes"}<ChangesPane {git} />{:else}<HistoryPane {git} />{/if}
      </aside>
      <Splitter
        ondrag={(dx) => {
          if (drag === null) start = width;
          drag = Math.min(MAX, Math.max(MIN, start + dx));
        }}
        onend={() => {
          if (drag === null) return;
          width = drag;
          drag = null;
          setSetting("gitLeft", width);
        }}
        onreset={() => {
          width = 350;
          setSetting("gitLeft", 350);
        }}
      />
      <DiffView {git} />
    </div>
  {/if}
</div>

<style>
  .git-tab {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-app);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 12px;
    flex-shrink: 0;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--line-2);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  aside {
    flex-shrink: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--line-2);
    border-radius: 13px;
    background: var(--bg-deep);
    color: var(--text-dim-1);
    font: inherit;
    font-size: 12px;
  }
  button.chip {
    cursor: pointer;
  }
  button.chip:hover {
    border-color: var(--accent-a40);
    color: var(--accent);
  }
  .chip b {
    font-weight: 600;
    color: var(--text-strong);
  }
  .chip code {
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: var(--text-dim-2);
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
    background: var(--bg-deep);
  }
  .seg button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--text-dim-1);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--text-strong);
  }
  .seg button.on {
    background: var(--accent-a15);
    color: var(--accent);
  }
  .seg i {
    font-style: normal;
    font-size: 10.5px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--accent);
    color: #1a1a1a;
    font-weight: 700;
  }
  .spacer {
    flex: 1;
  }
  .ib {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--text-dim-1);
    cursor: pointer;
  }
  .ib:hover {
    background: var(--hover);
    color: var(--text-strong);
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px;
    text-align: center;
    color: var(--text-dim-1);
    font-size: 13px;
  }
  .center b {
    font-size: 16px;
    color: var(--text-strong);
    font-weight: 600;
  }
  .center.dim {
    color: var(--text-dim-3);
  }
  .sub {
    max-width: 440px;
    line-height: 1.5;
    color: var(--text-dim-2);
  }
  .hero {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 74px;
    height: 74px;
    border-radius: 50%;
    background: var(--accent-a10);
    color: var(--accent);
  }
  .primary,
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 18px;
    border-radius: 9px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .primary {
    margin-top: 8px;
    border: none;
    background: var(--accent);
    color: #1a1a1a;
    font-weight: 600;
  }
  .primary:hover {
    filter: brightness(1.08);
  }
  .ghost {
    border: 1px solid var(--line-3);
    background: none;
    color: var(--text-dim-1);
  }
  .ghost:hover {
    border-color: var(--accent-a40);
    color: var(--accent);
  }
</style>
