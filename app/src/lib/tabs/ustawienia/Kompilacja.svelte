<script lang="ts">
  // Ustawienia › Kompilacja (docs/03-ux.md §7): auto-compile + delay, default engine
  // (detected installations with versions), copy PDF next to the main file, Tectonic
  // package cache (size, clear). Projects can override the engine (PDF bar → ⋯).
  import { onMount } from "svelte";
  import { getSetting, setSetting } from "#lib/core/appSettings.svelte.ts";
  import { call, inTauri } from "#lib/core/tauri.ts";
  import { ENGINES, type EngineId } from "#lib/build/build.svelte.ts";
  import { confirmAction } from "#lib/ui/dialogs.svelte.ts";
  import { formatSize } from "#lib/ui/format.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import Toggle from "#lib/ui/Toggle.svelte";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  interface Engines {
    tectonic: string | null;
    tex: { latexmk: string | null; latexmkVersion: string | null; pdflatex: string | null; xelatex: string | null; lualatex: string | null };
  }

  let engines = $state<Engines | null>(null);
  let cache = $state<{ path: string | null; bytes: number } | null>(null);
  let busy = $state(false);

  const auto = $derived(getSetting("build.auto", true));
  const delay = $derived(getSetting("build.delayMs", 200));
  const engine = $derived(getSetting<EngineId>("build.engine", "tectonic"));
  const copyPdf = $derived(getSetting("build.copyPdf", false));
  const DELAYS = [0, 200, 600, 1500];
  const live = $derived(getSetting("build.live", true));
  const fullMs = $derived(getSetting("build.fullMs", 2000));
  const FULLS = [1000, 2000, 4000, 8000];

  async function detect(refresh = false): Promise<void> {
    if (!inTauri()) return;
    engines = await call<Engines>("engines_detect", { refresh });
  }
  async function loadCache(): Promise<void> {
    if (!inTauri()) return;
    cache = await call("tectonic_cache");
  }
  onMount(() => {
    void detect();
    void loadCache();
  });

  /** Version line of an engine, or null when it is missing. */
  function version(id: EngineId): string | null {
    if (!engines) return null;
    if (id === "tectonic") return engines.tectonic ? `Tectonic ${engines.tectonic}` : null;
    if (!engines.tex.latexmk) return null;
    const v = engines.tex[id];
    // "pdfTeX 3.141592653-2.6-1.40.27 (TeX Live 2026)" → keep it short
    return v ? v.replace(/^(\S+)\s+(\S+).*?(\(.*\))?$/, (_, a: string, b: string, c?: string) => `${a} ${b.split("-").pop()}${c ? ` ${c}` : ""}`) : null;
  }

  async function clearCache(): Promise<void> {
    const ok = await confirmAction(
      "Wyczyścić cache Tectonic?",
      "Pakiety zostaną pobrane ponownie przy następnej kompilacji (potrzebny internet).",
      { confirmText: "Wyczyść", danger: true },
    );
    if (!ok) return;
    busy = true;
    try {
      await call("tectonic_cache_clear");
      toast("Wyczyszczono — silnik pobiera podstawowe pakiety", { icon: "cloud" });
      await loadCache();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { icon: "alert", error: true });
    } finally {
      busy = false;
    }
  }
</script>

{#snippet reset(key: string, def: unknown, now: unknown)}
  {#if now !== def}
    <button class="icon-btn reset" use:tip={"Przywróć domyślne"} onclick={() => setSetting(key, def)}><Icon name="undo" size={13} /></button>
  {:else}
    <span class="reset"></span>
  {/if}
{/snippet}

<div class="wrap">
  <div class="card">
    <div class="row">
      <Icon name="refresh" size={16} />
      <span class="k">Auto-kompilacja po zapisie</span>
      <span class="hint">domyślnie dla projektów</span>
      {@render reset("build.auto", true, auto)}
      <Toggle label="Auto-kompilacja" on={auto} onchange={(v) => setSetting("build.auto", v)} />
    </div>
    <div class="row">
      <Icon name="pause" size={16} />
      <span class="k">Opóźnienie startu</span>
      <span class="hint">po ostatniej zmianie pliku</span>
      {@render reset("build.delayMs", 200, delay)}
      <div class="seg">
        {#each DELAYS as d (d)}
          <button class:on={delay === d} onclick={() => setSetting("build.delayMs", d)}>{d < 1000 ? `${d} ms` : `${d / 1000} s`.replace(".", ",")}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <Icon name="engine" size={16} />
      <span class="k">Podgląd na żywo podczas pisania</span>
      <span class="hint">jeden szybki przebieg silnika; bibliografia i odnośniki dopiero w pełnej kompilacji (tylko TeX Live, nie Tectonic)</span>
      {@render reset("build.live", true, live)}
      <Toggle label="Podgląd na żywo" on={live} onchange={(v) => setSetting("build.live", v)} />
    </div>
    {#if live}
      <div class="row">
        <Icon name="pause" size={16} />
        <span class="k">Pełna kompilacja po przerwie</span>
        <span class="hint">po ostatniej zmianie; ⌘S robi ją od razu</span>
        {@render reset("build.fullMs", 2000, fullMs)}
        <div class="seg">
          {#each FULLS as d (d)}
            <button class:on={fullMs === d} onclick={() => setSetting("build.fullMs", d)}>{`${d / 1000} s`}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="row">
      <Icon name="download" size={16} />
      <span class="k">Kopiuj PDF obok pliku głównego</span>
      <span class="hint">po każdej udanej kompilacji (inaczej folder zostaje czysty)</span>
      {@render reset("build.copyPdf", false, copyPdf)}
      <Toggle label="Kopiuj PDF" on={copyPdf} onchange={(v) => setSetting("build.copyPdf", v)} />
    </div>
  </div>

  <div class="head">
    <span>Silnik domyślny</span>
    <button class="icon-btn" use:tip={"Wykryj ponownie"} onclick={() => void detect(true)}><Icon name="refresh" size={13} /></button>
  </div>
  <div class="engines">
    {#each ENGINES as e (e.id)}
      {@const v = version(e.id)}
      <button class="eng" class:on={engine === e.id} class:missing={engines !== null && !v} onclick={() => setSetting("build.engine", e.id)}>
        <span class="name"><Icon name={e.id === "tectonic" ? "engine" : "cpu"} size={15} /> {e.label}</span>
        <span class="ver">
          {#if engines === null}…{:else if v}{v}{:else if e.id === "tectonic"}brak binarki{:else}brak (latexmk + TeX Live){/if}
        </span>
        {#if e.id === "tectonic"}<span class="tag">wbudowany</span>{/if}
      </button>
    {/each}
  </div>
  <p class="note">
    Tectonic (XeTeX) jest w aplikacji i sam dociąga pakiety. pdfLaTeX / XeLaTeX / LuaLaTeX idą przez
    <code>latexmk</code> z systemowego TeX Live — przydatne, gdy szablon uczelni wymaga pdfLaTeX.
    Pliki pośrednie zawsze trafiają do cache aplikacji, nie do folderu projektu.
  </p>

  <div class="head"><span>Cache Tectonic</span></div>
  <div class="card">
    <div class="row">
      <Icon name="cloud" size={16} />
      <span class="k">{cache ? formatSize(cache.bytes) : "…"}</span>
      <span class="hint path" use:tip={cache?.path ?? ""}>{cache?.path ?? ""}</span>
      <button class="btn" disabled={busy || !cache?.bytes} onclick={() => void clearCache()}><Icon name="trash" size={13} /> Wyczyść</button>
    </div>
  </div>
</div>

<style>
  .wrap {
    width: min(720px, 100%);
    padding: 28px 32px;
    overflow: auto;
  }
  .card {
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 4px 14px;
    color: var(--text-dim-2);
  }
  .row + .row {
    border-top: 1px solid var(--line-1);
  }
  .k {
    font-size: var(--fs-md);
    color: var(--text);
  }
  .hint {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-dim-4);
  }
  .hint.path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .reset {
    width: 28px;
    flex-shrink: 0;
  }
  .seg {
    display: flex;
    border: 1px solid var(--line-3);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    padding: 0 8px;
    height: 24px;
    font-size: var(--fs-sm);
    background: none;
    border: none;
    color: var(--text-dim-2);
    cursor: pointer;
  }
  .seg button + button {
    border-left: 1px solid var(--line-3);
  }
  .seg button.on {
    background: var(--accent-a10);
    color: var(--accent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 26px 0 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-dim-2);
  }
  .engines {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .eng {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    text-align: left;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .eng:hover {
    border-color: var(--line-3);
    background: var(--hover);
  }
  .eng.on {
    border-color: var(--accent-a40);
    background: var(--accent-a10);
  }
  .eng.missing {
    opacity: 0.55;
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-md);
    color: var(--text);
  }
  .eng.on .name {
    color: var(--accent);
  }
  .ver {
    font-size: var(--fs-xs);
    color: var(--text-dim-3);
  }
  .tag {
    position: absolute;
    top: 9px;
    right: 10px;
    font-size: var(--fs-xs);
    color: var(--text-dim-3);
  }
  .note {
    margin-top: 10px;
    font-size: var(--fs-xs);
    line-height: 1.6;
    color: var(--text-dim-3);
  }
  code {
    font-family: var(--font);
    color: var(--text-dim-1);
  }
</style>
