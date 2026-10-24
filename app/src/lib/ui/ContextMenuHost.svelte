<script lang="ts">
  import { formatKeys } from "#lib/core/keys.ts";
  import Icon from "./Icon.svelte";
  import { closeMenu, currentMenu, type MenuItem } from "./contextMenu.svelte.ts";

  const m = $derived(currentMenu());
  let el = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let focus = $state(-1);
  const items = $derived((m?.items.filter((i) => i !== "sep") ?? []) as MenuItem[]);

  $effect(() => {
    if (!m || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    pos = {
      x: Math.min(m.x, window.innerWidth - w - 6),
      y: m.y + h > window.innerHeight - 6 ? Math.max(6, m.y - h) : m.y,
    };
    focus = -1;
  });

  function run(i: MenuItem): void {
    if (i.disabled) return;
    closeMenu();
    i.run();
  }

  function onKey(e: KeyboardEvent): void {
    if (!m) return;
    if (e.key === "Escape") closeMenu();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const n = items.length;
      let f = focus;
      for (let k = 0; k < n; k++) {
        f = (f + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        if (!items[f].disabled) break;
      }
      focus = f;
    } else if (e.key === "Enter" && focus >= 0) run(items[focus]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={onKey} onblur={closeMenu} />

{#if m}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onpointerdown={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }}></div>
  <div class="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" role="menu">
    {#each m.items as it, k (k)}
      {#if it === "sep"}
        <div class="sep"></div>
      {:else}
        <button
          class="item"
          class:danger={it.danger}
          class:focus={items.indexOf(it) === focus}
          disabled={it.disabled}
          role="menuitem"
          onclick={() => run(it)}
          onpointerenter={() => (focus = items.indexOf(it))}
        >
          <Icon name={it.icon} size={14} />
          <span class="lbl">{it.label}</span>
          {#if it.keys}<kbd>{formatKeys(it.keys)}</kbd>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1090;
  }
  .menu {
    position: fixed;
    z-index: 1100;
    min-width: 210px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: in 0.08s ease;
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 9px;
    font-size: var(--fs-md);
    color: var(--text-dim-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
  }
  .item.focus:not(:disabled) {
    background: var(--accent-a10);
    color: var(--text-strong);
  }
  .item.danger {
    color: var(--danger);
  }
  .item:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .lbl {
    flex: 1;
  }
  kbd {
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--text-dim-3);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line-2);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
</style>
