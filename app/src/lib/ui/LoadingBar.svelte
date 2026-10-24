<script lang="ts">
  // Thin animated bar under the tab bar while anything loads. Shown only after 150 ms,
  // so instant operations never flash it.
  import { busyCount } from "#lib/core/busy.svelte.ts";

  const busy = $derived(busyCount() > 0);
  let visible = $state(false);
  $effect(() => {
    if (!busy) {
      visible = false;
      return;
    }
    const t = setTimeout(() => (visible = true), 150);
    return () => clearTimeout(t);
  });
</script>

<div class="lb" class:on={visible}><div class="run"></div></div>

<style>
  .lb {
    position: relative;
    height: 2px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.25s;
    flex-shrink: 0;
  }
  .lb.on {
    opacity: 1;
  }
  .run {
    position: absolute;
    top: 0;
    left: -35%;
    width: 35%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    box-shadow: 0 0 8px var(--accent-a70);
    animation: run 1.1s ease-in-out infinite;
  }
  .lb:not(.on) .run {
    animation: none;
  }
  @keyframes run {
    to {
      left: 100%;
    }
  }
</style>
