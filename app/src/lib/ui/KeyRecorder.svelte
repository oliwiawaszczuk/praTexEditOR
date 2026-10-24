<script lang="ts">
  // One shortcut chip (docs/03-ux.md §7): click → "naciśnij klawisze…" (pulses), the
  // next keystroke is the binding, a second one within 1 s makes a chord. Esc cancels,
  // ⌫ removes the shortcut. A clash shows "koliduje z: X [⇄ zamień] [✕ anuluj]".
  import { onDestroy } from "svelte";
  import { command, conflicts, keysOf, pauseKeys, strokeOf, type When } from "#lib/core/commands.svelte.ts";
  import { bind, bindMany } from "#lib/core/keybindings.ts";
  import { formatKeys, isMac } from "#lib/core/keys.ts";
  import Icon from "./Icon.svelte";
  import { tip } from "./tooltip.svelte.ts";

  let { id, when = "global", fallback }: { id: string; when?: When; fallback?: string } = $props();

  let recording = $state(false);
  let strokes = $state<string[]>([]);
  let clash = $state<{ keys: string; others: { id: string; title: string }[] } | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resume: (() => void) | null = null;

  const current = $derived(keysOf(id) ?? (command(id) ? undefined : fallback));

  function start(): void {
    clash = null;
    strokes = [];
    recording = true;
    resume = pauseKeys();
    window.addEventListener("keydown", onKey, true);
  }

  function stop(): void {
    recording = false;
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener("keydown", onKey, true);
    resume?.();
    resume = null;
  }
  onDestroy(stop);

  function onKey(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && e.key === "Escape") return stop();
    if (plain && (e.key === "Backspace" || e.key === "Delete") && !strokes.length) {
      stop();
      void bind(id, "");
      return;
    }
    const s = strokeOf(e, isMac());
    if (!s) return;
    strokes = [...strokes, s];
    if (timer) clearTimeout(timer);
    if (strokes.length >= 2) commit();
    else timer = setTimeout(commit, 1000);
  }

  function commit(): void {
    const keys = strokes.join(" ");
    stop();
    if (!keys) return;
    const others = conflicts(id, keys, when);
    if (others.length) clash = { keys, others: others.map((c) => ({ id: c.id, title: c.title })) };
    else void bind(id, keys);
  }

  /** Take the keys; the other command(s) get my old keys (or none). */
  function swap(): void {
    if (!clash) return;
    const mine = current ?? "";
    const changes: Record<string, string | null> = { [id]: clash.keys };
    clash.others.forEach((o, i) => (changes[o.id] = i === 0 ? mine : ""));
    void bindMany(changes);
    clash = null;
  }
</script>

<span class="kr">
  <button class="chip" class:rec={recording} class:empty={!current && !recording} use:tip={recording ? "Esc: anuluj · ⌫: usuń skrót" : "Kliknij i naciśnij nowy skrót"} onclick={() => (recording ? stop() : start())}>
    {#if recording}
      {strokes.length ? formatKeys(strokes.join(" ")) + " …" : "naciśnij klawisze…"}
    {:else if current}
      {formatKeys(current)}
    {:else}
      <Icon name="plus" size={12} />
    {/if}
  </button>
  {#if clash}
    <span class="clash">
      <Icon name="alert" size={12} />
      {formatKeys(clash.keys)} koliduje z: {clash.others.map((o) => o.title).join(", ")}
      <button class="mini" use:tip={"Zamień (tamta dostanie mój dawny skrót)"} onclick={swap}><Icon name="replace" size={12} /></button>
      <button class="mini" use:tip={"Anuluj"} onclick={() => (clash = null)}><Icon name="close" size={12} /></button>
    </span>
  {/if}
</span>

<style>
  .kr {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .chip {
    min-width: 44px;
    height: 24px;
    padding: 0 8px;
    font-family: var(--font);
    font-size: var(--fs-sm);
    color: var(--text-dim-1);
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chip:hover {
    border-color: var(--accent-a40);
    color: var(--text);
  }
  .chip.empty {
    color: var(--text-dim-4);
    border-style: dashed;
  }
  .chip.rec {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-a10);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 3px var(--accent-a25);
    }
  }
  .clash {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 4px 2px 8px;
    font-size: var(--fs-xs);
    color: var(--danger);
    background: var(--danger-a15);
    border: 1px solid var(--danger-a40);
    border-radius: 12px;
  }
  .mini {
    display: inline-flex;
    padding: 2px;
    color: var(--text-dim-1);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .mini:hover {
    color: var(--accent);
    background: var(--hover);
  }
</style>
