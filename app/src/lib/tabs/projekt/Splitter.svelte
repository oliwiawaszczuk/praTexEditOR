<script lang="ts">
  // Vertical drag handle between columns. Reports the pointer delta; double-click resets.
  let {
    ondrag,
    onend,
    onreset,
  }: { ondrag: (dx: number) => void; onend: () => void; onreset: () => void } = $props();

  let active = $state(false);
  let startX = 0;

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    active = true;
    startX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add("col-resize");
  }
  function move(e: PointerEvent): void {
    if (active) ondrag(e.clientX - startX);
  }
  function up(): void {
    if (!active) return;
    active = false;
    document.body.classList.remove("col-resize");
    onend();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="split"
  class:active
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={onreset}
></div>

<style>
  .split {
    width: 5px;
    margin: 0 -2px;
    flex-shrink: 0;
    cursor: col-resize;
    position: relative;
    z-index: 5;
  }
  .split::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: var(--line-2);
    transition: background var(--t-fast), box-shadow var(--t-fast);
  }
  .split:hover::after,
  .split.active::after {
    background: var(--accent-a70);
    box-shadow: 0 0 6px var(--accent-a40);
  }
  :global(body.col-resize),
  :global(body.col-resize *) {
    cursor: col-resize !important;
    -webkit-user-select: none;
    user-select: none;
  }
</style>
