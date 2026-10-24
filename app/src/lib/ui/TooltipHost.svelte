<script lang="ts">
  import { currentTip } from "./tooltip.svelte.ts";

  const t = $derived(currentTip());
  let el = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });

  // Below the target, centred; flipped above near the bottom edge, clamped to the window.
  $effect(() => {
    if (!t || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = t.rect.bottom + 6;
    const y = below + h > window.innerHeight - 4 ? t.rect.top - h - 6 : below;
    const x = Math.min(Math.max(4, t.rect.left + t.rect.width / 2 - w / 2), window.innerWidth - w - 4);
    pos = { x, y };
  });
</script>

{#if t}
  <div class="tip" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" role="tooltip">
    <span>{t.label}</span>
    {#if t.keys}<kbd>{t.keys}</kbd>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 1200;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 9px;
    font-size: var(--fs-sm);
    color: var(--text-strong);
    background: var(--bg-deepest);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    white-space: nowrap;
    animation: in 0.1s ease;
  }
  kbd {
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  @keyframes in {
    from {
      opacity: 0;
    }
  }
</style>
