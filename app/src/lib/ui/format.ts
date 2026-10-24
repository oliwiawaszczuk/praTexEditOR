// Short, picture-like labels: "dziś", "wczoraj", "3 d", "2 tyg.", "5 mies.", "2 l.".

export function ago(ms: number, now = Date.now()): string {
  const day = 86_400_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return "dziś";
  if (ms >= start.getTime() - day) return "wczoraj";
  const d = Math.floor((now - ms) / day);
  if (d < 14) return `${d} d`;
  if (d < 60) return `${Math.floor(d / 7)} tyg.`;
  if (d < 365) return `${Math.floor(d / 30)} mies.`;
  return `${Math.floor(d / 365)} l.`;
}

/** 1536 → "1,5 kB" (Polish decimal comma). */
export function formatSize(bytes: number): string {
  const units = ["B", "kB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n = i === 0 || v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(".", ",");
  return `${n} ${units[i]}`;
}

/** 1234 → "1,2 s", 340 → "0,3 s", 75000 → "1:15". */
export function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}
