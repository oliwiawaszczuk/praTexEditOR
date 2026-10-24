<script lang="ts">
  // One project on the start screen. The page sketch becomes the real first-page
  // thumbnail once PDFs exist (E3).
  import type { Project } from "#lib/core/projects.svelte.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { ago } from "#lib/ui/format.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  let { p, onopen, onmenu }: { p: Project; onopen: () => void; onmenu: (e: MouseEvent) => void } = $props();
  const broken = $derived(p.rootsOk.some((ok) => !ok));
</script>

<button class="card" onclick={onopen} oncontextmenu={onmenu} style:--c={p.color}>
  <div class="thumb">
    <div class="page">
      <span class="l t"></span>
      <span class="l"></span>
      <span class="l"></span>
      <span class="l s"></span>
      <span class="l"></span>
      <span class="l s"></span>
    </div>
  </div>
  <div class="meta">
    <span class="dot"></span>
    <span class="name">{p.name}</span>
    {#if broken}
      <span class="warn" use:tip={"Brakuje folderu"}><Icon name="alert" size={13} /></span>
    {/if}
  </div>
  <div class="sub">
    <span class="chip" use:tip={"Foldery"}><Icon name="folder" size={11} />{p.roots.length}</span>
    <span class="chip" use:tip={"Ostatnio otwarty"}><Icon name="refresh" size={11} />{ago(p.openedAt)}</span>
  </div>
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    text-align: left;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: 10px;
    cursor: pointer;
    transition: border-color var(--t-fast), transform var(--t-fast), box-shadow var(--t-fast);
    animation: rise 0.3s ease both;
  }
  .card:hover {
    border-color: color-mix(in srgb, var(--c) 55%, transparent);
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  }
  .thumb {
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    border-radius: 6px;
    background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--c) 18%, var(--bg-deepest)), var(--bg-deepest));
  }
  .page {
    width: 58%;
    height: 86%;
    display: flex;
    flex-direction: column;
    gap: 6%;
    padding: 12% 10%;
    background: #f3f1ea;
    border-radius: 3px 3px 0 0;
    box-shadow: 0 -2px 14px rgba(0, 0, 0, 0.4);
    transition: transform 0.25s ease;
  }
  .card:hover .page {
    transform: translateY(-4%);
  }
  .l {
    height: 4px;
    border-radius: 2px;
    background: #c9c6bd;
  }
  .l.t {
    width: 60%;
    height: 6px;
    background: var(--c);
    margin-bottom: 4%;
  }
  .l.s {
    width: 70%;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .name {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    display: flex;
    color: var(--danger);
  }
  .sub {
    display: flex;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-dim-3);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
