<script lang="ts">
  // Ustawienia › O aplikacji: versions, folders, engine state and a one-click compile test.
  import { onMount } from "svelte";
  import { engine, engineSelftest, type CompileOutcome } from "#lib/core/engine.svelte.ts";
  import { call, inTauri } from "#lib/core/tauri.ts";
  import Icon from "#lib/ui/Icon.svelte";
  import { toast } from "#lib/ui/toast.svelte.ts";
  import { tip } from "#lib/ui/tooltip.svelte.ts";

  interface Diag {
    appVersion: string;
    os: string;
    arch: string;
    dataDir: string;
    cacheDir: string;
    tectonic: string | null;
  }

  let diag = $state<Diag | null>(null);
  let testing = $state(false);
  let result = $state<CompileOutcome | null>(null);
  let failure = $state("");
  const s = $derived(engine());

  onMount(async () => {
    if (inTauri()) diag = await call<Diag>("diagnostics");
  });

  async function runTest(): Promise<void> {
    testing = true;
    result = null;
    failure = "";
    try {
      result = await engineSelftest();
    } catch (e) {
      failure = String(e);
    } finally {
      testing = false;
    }
  }

  async function copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    toast("Skopiowano ścieżkę", { icon: "copy" });
  }

  const PHASE: Record<string, string> = {
    checking: "sprawdzanie…",
    warming: "przygotowanie (jednorazowo)",
    ready: "gotowy",
    error: "błąd",
    missing: "brak binarki",
  };
</script>

<div class="wrap">
  <header>
    <img class="logo" src="/logo.png" alt="" width="56" height="56" />
    <div>
      <h1>praTexEditOR</h1>
      <span class="sub">{diag ? `${diag.appVersion} · ${diag.os} ${diag.arch}` : "—"}</span>
    </div>
  </header>

  <div class="card">
    <div class="row">
      <Icon name="engine" size={16} />
      <span class="k">Silnik</span>
      <span class="v">Tectonic {s.version ?? ""}</span>
      <span class="state" class:ok={s.phase === "ready"} class:bad={s.phase === "error" || s.phase === "missing"}>
        {PHASE[s.phase]}{s.phase === "warming" ? ` · ${s.downloads}` : ""}
      </span>
    </div>
    {#if s.phase === "error" || s.phase === "missing"}
      <pre class="tail">{s.detail}</pre>
    {/if}
    <div class="row">
      <Icon name="play" size={16} />
      <span class="k">Test kompilacji</span>
      <span class="v">
        {#if testing}
          <span class="spin"><Icon name="refresh" size={14} /></span>
        {:else if result}
          <span class:ok={result.ok} class:bad={!result.ok}>
            <Icon name={result.ok ? "check" : "alert"} size={14} />
            {(result.durationMs / 1000).toFixed(2).replace(".", ",")} s
          </span>
        {:else if failure}
          <span class="bad">{failure}</span>
        {/if}
      </span>
      <button class="btn primary" disabled={testing || !inTauri()} onclick={runTest} use:tip={"Skompiluj „Hello, świat!”"}>
        <Icon name="play" size={12} />
      </button>
    </div>
    {#if result && !result.ok}
      <pre class="tail">{result.tail.join("\n")}</pre>
    {/if}
  </div>

  {#if diag}
    <div class="card">
      {#each [{ k: "Dane", v: diag.dataDir, i: "folder" }, { k: "Cache", v: diag.cacheDir, i: "folder" }, { k: "Tectonic", v: diag.tectonic ?? "—", i: "file" }] as r (r.k)}
        <div class="row">
          <Icon name={r.i as "folder" | "file"} size={16} />
          <span class="k">{r.k}</span>
          <span class="v path">{r.v}</span>
          <button class="icon-btn" use:tip={"Kopiuj ścieżkę"} onclick={() => copy(r.v)}><Icon name="copy" /></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    width: min(720px, 100%);
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo {
    display: block;
    filter: drop-shadow(0 0 10px var(--accent-a25));
  }
  h1 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-strong);
  }
  .sub {
    font-size: var(--fs-sm);
    color: var(--text-dim-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
    border: 1px solid var(--line-2);
    border-radius: var(--radius-md);
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 4px 14px;
    color: var(--text-dim-2);
  }
  .row + .row {
    border-top: 1px solid var(--line-1);
  }
  .k {
    width: 130px;
    flex-shrink: 0;
    font-size: var(--fs-sm);
  }
  .v {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-md);
    color: var(--text);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    -webkit-user-select: text;
    user-select: text;
  }
  .state {
    font-size: var(--fs-sm);
    color: var(--accent);
  }
  .ok {
    color: var(--ok);
  }
  .bad {
    color: var(--danger);
  }
  .ok,
  .bad {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .tail {
    margin: 0 14px 10px;
    padding: 8px 10px;
    max-height: 220px;
    overflow: auto;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--text-dim-1);
    background: var(--bg-deepest);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    -webkit-user-select: text;
    user-select: text;
  }
  .spin {
    display: flex;
    color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
