<script lang="ts">
  // Empty state for parts of the app that arrive in a later stage (docs/02-plan.md §13).
  import Icon, { type IconName } from "#lib/ui/Icon.svelte";

  let { icon, title, stage }: { icon: IconName; title: string; stage: string } = $props();
</script>

<div class="ph">
  <span class="big"><Icon name={icon} size={64} /></span>
  <span class="title">{title}</span>
  <span class="stage">{stage}</span>
</div>

<style>
  .ph {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    animation: fadein 0.35s ease;
  }
  .big {
    display: flex;
    color: var(--text-dim-4);
  }
  .title {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-dim-2);
  }
  .stage {
    padding: 2px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-a10);
    border: 1px solid var(--accent-a30);
    border-radius: 10px;
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
  }
</style>
