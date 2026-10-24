<script lang="ts">
  // Color picker: a swatch that opens a popover with a saturation/value field, a hue
  // slider, a hex field and preset swatches. Changes apply live (`onchange`); Enter or a
  // click outside keeps the color, Esc puts the previous one back. Keyboard: arrows move
  // the field handle / hue (Shift = ×10), Tab walks the controls. The popover exists only
  // while open — nothing runs in the background.
  import { tick } from "svelte";
  import { hexToHsv, hsvToHex, parseHex, type Hsv } from "./color.ts";
  import Icon from "./Icon.svelte";
  import { tip } from "./tooltip.svelte.ts";

  interface Props {
    value: string;
    onchange: (hex: string) => void;
    /** Quick swatches under the field (default: the project palette). */
    presets?: string[];
    disabled?: boolean;
    label?: string;
    /** Trigger height in px (width +8, or a circle when `round`). */
    size?: number;
    round?: boolean;
  }

  let { value, onchange, presets = [], disabled = false, label = "Kolor", size = 26, round = false }: Props = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let field = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0, up: false });
  let hsv = $state<Hsv>({ h: 0, s: 0, v: 0 });
  let hexText = $state("");
  let hexBad = $state(false);
  let before = $state("");
  let emitted = "";

  const current = $derived(hsvToHex(hsv));
  const canPipette = typeof window !== "undefined" && "EyeDropper" in window;

  // The color changed from outside (not by us) while open: follow it.
  $effect(() => {
    const v = parseHex(value) ?? "#000000";
    if (open && v !== emitted) {
      hsv = hexToHsv(v);
      hexText = v;
    }
  });

  async function show(): Promise<void> {
    if (disabled) return;
    before = parseHex(value) ?? "#000000";
    emitted = before;
    hsv = hexToHsv(before);
    hexText = before;
    hexBad = false;
    const r = trigger!.getBoundingClientRect();
    const W = 244;
    const H = 330;
    const up = r.bottom + 8 + H > window.innerHeight && r.top - 8 - H > 0;
    pos = { left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)), top: up ? r.top - 8 : r.bottom + 8, up };
    open = true;
    await tick();
    field?.focus();
  }

  function close(revert: boolean): void {
    if (!open) return;
    open = false;
    if (revert && emitted !== before) {
      emitted = before;
      onchange(before);
    }
    trigger?.focus();
  }

  function push(next: Hsv): void {
    hsv = next;
    const hex = hsvToHex(next);
    hexText = hex;
    hexBad = false;
    if (hex !== emitted) {
      emitted = hex;
      onchange(hex);
    }
  }

  // ── Saturation / value field ──
  let dragging = false;
  function fieldAt(e: PointerEvent): void {
    const r = field!.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    push({ ...hsv, s, v });
  }
  function fieldDown(e: PointerEvent): void {
    dragging = true;
    field?.setPointerCapture(e.pointerId);
    fieldAt(e);
  }
  function fieldKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    push({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + m[0])), v: Math.min(1, Math.max(0, hsv.v + m[1])) });
  }

  // ── Hue slider ──
  let hueEl = $state<HTMLDivElement>();
  let hueDrag = false;
  function hueAt(e: PointerEvent): void {
    const r = hueEl!.getBoundingClientRect();
    push({ ...hsv, h: Math.min(359.99, Math.max(0, ((e.clientX - r.left) / r.width) * 360)) });
  }
  function hueDown(e: PointerEvent): void {
    hueDrag = true;
    hueEl?.setPointerCapture(e.pointerId);
    hueAt(e);
  }
  function hueKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 10 : 1;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    push({ ...hsv, h: (hsv.h + (e.key === "ArrowRight" ? step : -step) + 360) % 360 });
  }

  // ── Hex field ──
  function hexInput(): void {
    const p = parseHex(hexText);
    hexBad = !p && hexText.trim() !== "";
    if (p) push(hexToHsv(p));
  }
  function hexKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (parseHex(hexText)) close(false);
    }
  }
  function pick(hex: string): void {
    push(hexToHsv(hex));
  }

  async function pipette(): Promise<void> {
    try {
      const ED = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const r = await new ED().open();
      const p = parseHex(r.sRGBHex);
      if (p) push(hexToHsv(p));
    } catch {
      // cancelled
    }
  }

  function onWindowDown(e: PointerEvent): void {
    if (!open) return;
    const t = e.target as Node;
    if (pop?.contains(t) || trigger?.contains(t)) return;
    close(false);
  }
  function onKey(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydowncapture={onKey} onresize={() => close(false)} />

<button
  bind:this={trigger}
  type="button"
  class="swatch"
  class:open
  {disabled}
  style:--c={value}
  class:round
  style:width="{round ? size : size + 8}px"
  style:height="{size}px"
  aria-label={label}
  aria-haspopup="dialog"
  aria-expanded={open}
  use:tip={label}
  onclick={() => (open ? close(false) : void show())}
></button>

{#if open}
  <div
    bind:this={pop}
    class="pop"
    class:up={pos.up}
    role="dialog"
    aria-label={label}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
  >
    <div
      bind:this={field}
      class="sv"
      style:--hue="hsl({hsv.h} 100% 50%)"
      role="slider"
      tabindex="0"
      aria-label="Nasycenie i jasność"
      aria-valuetext={current}
      aria-valuenow={Math.round(hsv.s * 100)}
      onpointerdown={fieldDown}
      onpointermove={(e) => dragging && fieldAt(e)}
      onpointerup={() => (dragging = false)}
      onkeydown={fieldKey}
    >
      <span class="knob" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={current}></span>
    </div>

    <div
      bind:this={hueEl}
      class="hue"
      role="slider"
      tabindex="0"
      aria-label="Odcień"
      aria-valuemin="0"
      aria-valuemax="360"
      aria-valuenow={Math.round(hsv.h)}
      onpointerdown={hueDown}
      onpointermove={(e) => hueDrag && hueAt(e)}
      onpointerup={() => (hueDrag = false)}
      onkeydown={hueKey}
    >
      <span class="knob" style:left="{(hsv.h / 360) * 100}%" style:background="hsl({hsv.h} 100% 50%)"></span>
    </div>

    <div class="row">
      <span class="cmp" aria-hidden="true">
        <span style:background={before}></span>
        <span style:background={current}></span>
      </span>
      <input
        class="hex"
        class:bad={hexBad}
        bind:value={hexText}
        oninput={hexInput}
        onkeydown={hexKey}
        onfocus={(e) => e.currentTarget.select()}
        spellcheck="false"
        maxlength="7"
        aria-label="Kod hex"
      />
      {#if canPipette}
        <button type="button" class="icon-btn" use:tip={"Pobierz kolor z ekranu"} onclick={() => void pipette()}><Icon name="dropper" size={15} /></button>
      {/if}
    </div>

    {#if presets.length}
      <div class="presets">
        {#each presets as c (c)}
          <button type="button" class="p" class:on={c.toLowerCase() === current} style:background={c} aria-label={c} use:tip={c} onclick={() => pick(c)}></button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

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

  .pop {
    position: fixed;
    z-index: 1100;
    width: 244px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 40px var(--backdrop);
    transform-origin: top left;
    animation: pop-in 0.14s cubic-bezier(0.2, 0.9, 0.3, 1.1);
  }
  .pop.up {
    transform: translateY(-100%);
    transform-origin: bottom left;
    animation-name: pop-in-up;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }
  @keyframes pop-in-up {
    from {
      opacity: 0;
      transform: translateY(calc(-100% + 4px)) scale(0.97);
    }
  }

  .sv {
    position: relative;
    height: 150px;
    border-radius: 6px;
    cursor: crosshair;
    touch-action: none;
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, var(--hue));
  }
  .hue {
    position: relative;
    height: 12px;
    border-radius: 6px;
    cursor: pointer;
    touch-action: none;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
  .sv:focus-visible,
  .hue:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .knob {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.45),
      0 1px 4px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  .hue .knob {
    top: 50%;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cmp {
    flex-shrink: 0;
    display: flex;
    width: 40px;
    height: 28px;
    overflow: hidden;
    border: 1px solid var(--line-3);
    border-radius: 6px;
  }
  .cmp span {
    flex: 1;
  }
  .hex {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    font-family: var(--font);
    font-size: var(--fs-md);
    text-transform: lowercase;
    color: var(--text);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 6px;
    outline: none;
  }
  .hex:focus {
    border-color: var(--accent);
  }
  .hex.bad {
    border-color: var(--danger);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 6px;
  }
  .p {
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--line-3);
    border-radius: 50%;
    cursor: pointer;
    transition: transform var(--t-fast);
  }
  .p:hover {
    transform: scale(1.12);
  }
  .p.on {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .pop,
    .swatch,
    .p {
      animation: none;
      transition: none;
    }
  }
</style>
