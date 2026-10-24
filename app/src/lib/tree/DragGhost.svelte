<script lang="ts">
  // Follows the pointer during an in-app drag: icon, name / count, "+" when copying (⌥).
  import Icon from "#lib/ui/Icon.svelte";
  import { dragGhost } from "./dnd.svelte.ts";

  const g = $derived(dragGhost());
</script>

{#if g}
  <div class="ghost" style:transform="translate({g.x + 14}px, {g.y + 10}px)">
    <Icon name={g.count > 1 ? "duplicate" : "file"} size={14} />
    <span>{g.label}</span>
    {#if g.copy}<span class="plus"><Icon name="plus" size={12} /></span>{/if}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 1300;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    font-size: var(--fs-sm);
    color: var(--text-strong);
    background: var(--bg-panel);
    border: 1px solid var(--accent-a40);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    will-change: transform;
  }
  .plus {
    display: flex;
    color: var(--ok);
  }
  :global(body.dragging),
  :global(body.dragging *) {
    cursor: grabbing !important;
  }
</style>
