<script lang="ts">
  // A color swatch that opens the shared popover (ColorPopupHost): saturation/value
  // field, hue slider, hex field, presets. Click again (or Esc / outside click) closes.
  import { closeColor, colorRequest, openColor } from "./colorPopup.svelte.ts";
  import { tip } from "./tooltip.svelte.ts";

  interface Props {
    value: string;
    onchange: (hex: string) => void;
    /** Quick swatches under the field. */
    presets?: string[];
    disabled?: boolean;
    label?: string;
    /** Trigger height in px (width +8, or a circle when `round`). */
    size?: number;
    round?: boolean;
  }

  let { value, onchange, presets = [], disabled = false, label = "Kolor", size = 26, round = false }: Props = $props();

  let trigger = $state<HTMLButtonElement>();
  let myId = $state(0);
  const open = $derived(myId !== 0 && colorRequest()?.id === myId);

  function toggle(): void {
    if (open) return closeColor();
    myId = openColor({ anchor: trigger!.getBoundingClientRect(), value, onchange, presets, label, onclose: () => trigger?.focus() });
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class="swatch"
  class:open
  class:round
  data-color-trigger
  {disabled}
  style:--c={value}
  style:width="{round ? size : size + 8}px"
  style:height="{size}px"
  aria-label={label}
  aria-haspopup="dialog"
  aria-expanded={open}
  use:tip={label}
  onclick={toggle}
></button>

<style>
  .swatch {
    flex-shrink: 0;
    padding: 0;
    border: 1px solid var(--line-3);
    border-radius: 6px;
    background:
      linear-gradient(var(--c), var(--c)),
      repeating-conic-gradient(var(--line-2) 0% 25%, transparent 0% 50%) 50% / 8px 8px;
    cursor: pointer;
    transition:
      border-color var(--t-fast),
      transform var(--t-fast);
  }
  .swatch.round {
    border-radius: 50%;
  }
  .swatch:hover:not(:disabled),
  .swatch.open {
    border-color: var(--accent);
  }
  .swatch:active:not(:disabled) {
    transform: scale(0.96);
  }
  .swatch:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .swatch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .swatch {
      transition: none;
    }
  }
</style>
