// TeX engine readiness (Rust: engine/status.rs). The first launch downloads Tectonic's
// format and packages in the background; the UI only shows a small chip meanwhile.

import { call, inTauri, on } from "./tauri.ts";

export type EnginePhase = "checking" | "warming" | "ready" | "error" | "missing";

export interface EngineStatus {
  phase: EnginePhase;
  version: string | null;
  detail: string;
  downloads: number;
}

export interface CompileOutcome {
  ok: boolean;
  durationMs: number;
  pdf: string | null;
  tail: string[];
}

let status = $state<EngineStatus>({ phase: "checking", version: null, detail: "", downloads: 0 });

export const engine = (): EngineStatus => status;

export async function watchEngine(): Promise<() => void> {
  if (!inTauri()) return () => {};
  // Subscribe first, then read: a status emitted in between is never lost.
  const off = await on<EngineStatus>("engine-status", (s) => (status = s));
  status = await call<EngineStatus>("engine_status");
  return off;
}

export const engineSelftest = (): Promise<CompileOutcome> => call<CompileOutcome>("engine_selftest");
