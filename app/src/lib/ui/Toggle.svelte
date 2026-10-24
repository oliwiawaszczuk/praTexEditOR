<script lang="ts">
  let { on, onchange, label }: { on: boolean; onchange: (v: boolean) => void; label: string } = $props();
</script>

<button class="tg" class:on role="switch" aria-checked={on} aria-label={label} onclick={() => onchange(!on)}>
  <span class="knob"></span>
</button>

<style>
  .tg {
    width: 34px;
    height: 20px;
    flex-shrink: 0;
    padding: 2px;
    background: var(--bg-deepest);
    border: 1px solid var(--line-3);
    border-radius: 10px;
    cursor: pointer;
    transition: background var(--t-fast), border-color var(--t-fast);
  }
  .knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-dim-3);
    transition: transform var(--t-fast), background var(--t-fast);
  }
  .tg.on {
    background: var(--accent-a25);
    border-color: var(--accent-a40);
  }
  .tg.on .knob {
    transform: translateX(14px);
    background: var(--accent);
  }
</style>
