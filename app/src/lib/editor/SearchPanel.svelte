<script lang="ts">
  // Find / replace above the text (CodeMirror panel, mounted by searchPanel.ts).
  // Icons instead of CodeMirror's text buttons; live match counter.
  import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    replaceAll,
    replaceNext,
    SearchQuery,
    selectMatches,
    setSearchQuery,
  } from "@codemirror/search";
  import type { EditorView, ViewUpdate } from "@codemirror/view";
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  let { view, replace = false }: { view: EditorView; replace?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let q = $state.raw(getSearchQuery(view.state));
  // svelte-ignore state_referenced_locally
  let showReplace = $state(replace);
  let count = $state({ cur: 0, total: 0 });
  let replaceEl = $state<HTMLInputElement>();
  const LIMIT = 9999;

  export function openReplace(): void {
    showReplace = true;
    queueMicrotask(() => replaceEl?.focus());
  }

  export function refresh(u: ViewUpdate): void {
    const nq = getSearchQuery(u.state);
    const changed = !nq.eq(q);
    if (changed) q = nq;
    if (changed || u.docChanged || u.selectionSet) recount();
  }

  function set(patch: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>): void {
    q = new SearchQuery({ search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord, ...patch });
    view.dispatch({ effects: setSearchQuery.of(q) });
    recount();
  }

  function recount(): void {
    if (!q.valid) {
      count = { cur: 0, total: 0 };
      return;
    }
    const sel = view.state.selection.main;
    let total = 0;
    let cur = 0;
    const c = q.getCursor(view.state);
    for (let r = c.next(); !r.done && total < LIMIT; r = c.next()) {
      total++;
      if (r.value.from === sel.from && r.value.to === sel.to) cur = total;
    }
    count = { cur, total };
  }
  recount();

  function findKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.altKey) {
        selectMatches(view);
        view.focus();
      } else if (e.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  }

  function replaceKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) replaceAll(view);
      else replaceNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  }

  const OPTS: { key: "caseSensitive" | "wholeWord" | "regexp"; icon: IconName; label: string }[] = [
    { key: "caseSensitive", icon: "caseSensitive", label: "Wielkość liter" },
    { key: "wholeWord", icon: "wholeWord", label: "Całe słowa" },
    { key: "regexp", icon: "regex", label: "Wyrażenie regularne" },
  ];
</script>

<div class="sp">
  <div class="row">
    <button class="icon-btn sm" class:open={showReplace} use:tip={{ label: "Zamień", keys: "mod+alt+f" }} onclick={() => (showReplace = !showReplace)}>
      <Icon name="chevronRight" size={13} />
    </button>
    <div class="field" class:bad={!!q.search && !q.valid}>
      <input
        {...{ "main-field": "true" }}
        value={q.search}
        placeholder="szukaj"
        spellcheck="false"
        oninput={(e) => set({ search: e.currentTarget.value })}
        onkeydown={findKey}
      />
      {#each OPTS as o (o.key)}
        <button class="opt" class:on={q[o.key]} use:tip={o.label} onclick={() => set({ [o.key]: !q[o.key] })}>
          <Icon name={o.icon} size={13} />
        </button>
      {/each}
    </div>
    <span class="count" class:none={!!q.search && count.total === 0}>
      {#if q.search}{count.cur || "–"}/{count.total >= LIMIT ? `${LIMIT}+` : count.total}{/if}
    </span>
    <button class="icon-btn sm" use:tip={{ label: "Poprzednie", keys: "shift+enter" }} onclick={() => findPrevious(view)}>
      <Icon name="chevronUp" size={14} />
    </button>
    <button class="icon-btn sm" use:tip={{ label: "Następne", keys: "enter" }} onclick={() => findNext(view)}>
      <Icon name="chevronDown" size={14} />
    </button>
    <button class="icon-btn sm" use:tip={{ label: "Zaznacz wszystkie", keys: "alt+enter" }} onclick={() => { selectMatches(view); view.focus(); }}>
      <Icon name="selection" size={14} />
    </button>
    <button class="icon-btn sm" use:tip={{ label: "Zamknij", keys: "escape" }} onclick={() => closeSearchPanel(view)}>
      <Icon name="close" size={14} />
    </button>
  </div>
  {#if showReplace}
    <div class="row">
      <span class="gap"></span>
      <div class="field">
        <input
          bind:this={replaceEl}
          value={q.replace}
          placeholder="zamień na"
          spellcheck="false"
          oninput={(e) => set({ replace: e.currentTarget.value })}
          onkeydown={replaceKey}
        />
      </div>
      <button class="icon-btn sm" use:tip={{ label: "Zamień", keys: "enter" }} onclick={() => replaceNext(view)}>
        <Icon name="replace" size={14} />
      </button>
      <button class="icon-btn sm" use:tip={{ label: "Zamień wszystkie", keys: "mod+enter" }} onclick={() => replaceAll(view)}>
        <Icon name="replaceAll" size={14} />
      </button>
    </div>
  {/if}
</div>

<style>
  .sp {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px 10px 5px 6px;
    font-family: var(--font);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .sm {
    width: 24px;
    height: 24px;
  }
  .open :global(svg) {
    transform: rotate(90deg);
  }
  .gap {
    width: 24px;
    flex-shrink: 0;
  }
  .field {
    flex: 1;
    max-width: 380px;
    min-width: 120px;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 3px 0 0;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }
  .field:focus-within {
    border-color: var(--accent-a40);
  }
  .field.bad {
    border-color: var(--danger);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    font-size: var(--fs-md);
    background: transparent;
    border: none;
    outline: none;
  }
  .opt {
    display: inline-flex;
    padding: 2px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-dim-3);
    cursor: pointer;
  }
  .opt:hover {
    color: var(--text);
  }
  .opt.on {
    color: var(--accent);
    background: var(--accent-a10);
    border-color: var(--accent-a30);
  }
  .count {
    min-width: 54px;
    padding: 0 6px;
    font-size: var(--fs-xs);
    color: var(--text-dim-2);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .count.none {
    color: var(--danger);
  }
</style>
