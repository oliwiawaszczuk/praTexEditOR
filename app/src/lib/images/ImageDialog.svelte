<script lang="ts">
  // ⌘V with a screenshot (docs/03-ux.md §6): thumbnail, name (selected — just type or
  // press Enter), folder, two tiles (picture / figure + caption), "nie pytaj".
  import { tick } from "svelte";
  import { currentProject } from "#lib/core/projects.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { imageAsk, type ImageMode } from "./images.svelte.ts";

  const a = $derived(imageAsk());
  let name = $state("");
  let dir = $state("");
  let mode = $state<ImageMode>("figure");
  let noAsk = $state(false);
  let input = $state<HTMLInputElement>();

  $effect(() => {
    if (!a) return;
    name = a.name;
    dir = a.dir;
    mode = a.mode;
    noAsk = false;
    void tick().then(() => input?.select());
  });

  function rel(d: string): string {
    const p = currentProject();
    const root = p?.roots.find((r) => d === r || d.startsWith(r + "/"));
    if (!p || !root) return d;
    const name = root.split("/").pop() ?? root;
    return d === root ? `${name}/` : `${name}/${d.slice(root.length + 1)}/`;
  }

  function ok(): void {
    if (!a || !name.trim()) return;
    a.resolve({ name: name.trim(), dir, mode, noAsk });
  }
  function cancel(): void {
    a?.resolve(null);
  }
  function onKey(e: KeyboardEvent): void {
    if (!a) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      ok();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if a}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={cancel}>
    <div class="modal" role="dialog" aria-label="Wstaw obraz" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="top">
        <img class="thumb" src={a.url} alt="" />
        <div class="fields">
          <label class="f"><span>nazwa</span><span class="nm"><input class="input" bind:this={input} bind:value={name} spellcheck="false" /><em>.{a.ext}</em></span></label>
          <label class="f">
            <span>folder</span>
            <select class="input" bind:value={dir}>
              {#each a.dirs as d (d)}<option value={d}>{rel(d)}</option>{/each}
            </select>
          </label>
          <div class="tiles">
            <button class="tile" class:on={mode === "plain"} onclick={() => (mode = "plain")}><Icon name="image" size={20} /><span>sam obraz</span></button>
            <button class="tile" class:on={mode === "figure"} onclick={() => (mode = "figure")}><Icon name="note" size={20} /><span>rysunek + podpis</span></button>
          </div>
        </div>
      </div>
      <div class="bottom">
        <label class="chk"><input type="checkbox" bind:checked={noAsk} /> nie pytaj, używaj tych ustawień</label>
        <button class="btn" onclick={cancel}>Esc</button>
        <button class="btn primary" onclick={ok}><Icon name="check" size={14} /> Wstaw</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 890;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--backdrop);
  }
  .modal {
    width: min(620px, 92vw);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-panel);
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 40px var(--backdrop);
  }
  .top {
    display: flex;
    gap: 16px;
  }
  .thumb {
    width: 170px;
    height: 150px;
    object-fit: contain;
    background: repeating-conic-gradient(var(--line-2) 0 25%, transparent 0 50%) 0 0 / 14px 14px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
  }
  .fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .f {
    display: grid;
    grid-template-columns: 54px 1fr;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
  }
  .nm {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .nm input {
    flex: 1;
  }
  em {
    font-style: normal;
    color: var(--text-dim-3);
  }
  .tiles {
    display: flex;
    gap: 8px;
  }
  .tile {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .tile.on {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .bottom {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chk {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-dim-2);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
