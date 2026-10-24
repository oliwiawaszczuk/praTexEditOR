<script lang="ts">
  // Floating note pad (⌘⇧M) over every tab: the pinned note, editable, draggable by its
  // header. Position = global UI chrome → app settings.
  import { fly } from "svelte/transition";
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";
  import { editNote, flushNote, loadNotes, loadNoteText, noteText, notes, notesLoaded } from "./notes.svelte.ts";
  import { padOpen, pinnedNoteId, setPadOpen, setPinned } from "./pad.svelte.ts";

  const W = 340;
  const H = 300;
  let top = $state(getSetting<number | null>("notatki.padTop", null));
  let left = $state(getSetting<number>("notatki.padLeft", 16));
  let winH = $state(window.innerHeight);
  let dragging = false;
  let start = { x: 0, y: 0, top: 0, left: 0 };
  const id = $derived(pinnedNoteId());

  const title = $derived(notes().find((n) => n.id === pinnedNoteId())?.title ?? "");
  const y = $derived(Math.max(4, Math.min(top ?? winH - H - 16, winH - 60)));

  // The shared buffer is loaded once per note (a note deleted elsewhere gets unpinned).
  $effect(() => {
    if (!id || !padOpen()) return;
    if (!notesLoaded()) void loadNotes();
    loadNoteText(id).catch(() => setPinned(null));
  });

  function onDown(e: PointerEvent): void {
    e.preventDefault();
    dragging = true;
    start = { x: e.clientX, y: e.clientY, top: y, left };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (!dragging) return;
    top = Math.min(Math.max(4, start.top + e.clientY - start.y), window.innerHeight - 40);
    left = Math.min(Math.max(4, start.left + e.clientX - start.x), window.innerWidth - 60);
  }
  function onUp(): void {
    if (!dragging) return;
    dragging = false;
    setSetting("notatki.padTop", top);
    setSetting("notatki.padLeft", left);
  }
</script>

<svelte:window onresize={() => (winH = window.innerHeight)} />

{#if pinnedNoteId() && padOpen()}
  <div class="pad" style:top="{y}px" style:left="{left}px" style:width="{W}px" style:height="{H}px" transition:fly={{ y: -12, duration: 160 }} role="dialog" aria-label="Notatnik" tabindex="-1">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="head" onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp}>
      <Icon name="pin" size={12} />
      <span class="t">{title || "Notatka"}</span>
      <button class="hb" use:tip={"Zwiń (⌘⇧M)"} onpointerdown={(e) => e.stopPropagation()} onclick={() => setPadOpen(false)}><Icon name="minus" size={13} /></button>
      <button class="hb" use:tip={"Odepnij"} onpointerdown={(e) => e.stopPropagation()} onclick={() => (void flushNote(), setPinned(null))}><Icon name="close" size={13} /></button>
    </div>
    <textarea
      value={noteText(id as string)}
      oninput={(e) => editNote(id as string, e.currentTarget.value)}
      onkeydown={(e) => e.key === "Escape" && setPadOpen(false)}
      placeholder="Zacznij pisać… pierwsza linia staje się tytułem"
      spellcheck="false"
    ></textarea>
  </div>
{/if}

<style>
  .pad {
    position: fixed;
    z-index: 800;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 10px 32px var(--backdrop);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 10px;
    color: var(--accent);
    background: var(--bg-panel-2);
    border-bottom: 1px solid var(--line-2);
    cursor: grab;
    user-select: none;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim-1);
  }
  .hb {
    display: flex;
    padding: 3px;
    color: var(--text-dim-3);
    background: none;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
  }
  .hb:hover {
    color: var(--text);
    background: var(--hover);
  }
  textarea {
    flex: 1;
    min-height: 0;
    resize: none;
    padding: 10px 12px;
    font: inherit;
    font-size: var(--fs-md);
    line-height: 1.55;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
  }
</style>
