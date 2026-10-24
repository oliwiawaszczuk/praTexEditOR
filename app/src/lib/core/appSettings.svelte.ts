// Global settings shared by every project (app_settings.json in the app data dir).
// Per-project UI state goes through the project store (E1) instead.

import { debouncedSaver } from "./persisted.ts";
import { call, inTauri } from "./tauri.ts";

let cache = $state<Record<string, unknown>>({});

const saver = debouncedSaver(500, () => call("settings_set", { value: $state.snapshot(cache) }));

export async function loadAppSettings(): Promise<void> {
  if (!inTauri()) return;
  cache = await call<Record<string, unknown>>("settings_get");
}

export function getSetting<T>(key: string, fallback: T): T {
  return key in cache ? (cache[key] as T) : fallback;
}

export function setSetting(key: string, value: unknown): void {
  // Skip no-op writes of primitives; objects are always saved (callers may pass a
  // mutated copy, and a proxy never === its raw source anyway).
  if (typeof value !== "object" && cache[key] === value) return;
  cache[key] = value;
  if (inTauri()) saver.schedule();
}

export const flushAppSettings = saver.flush;
