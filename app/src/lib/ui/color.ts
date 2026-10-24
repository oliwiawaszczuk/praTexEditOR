// Color math for ColorPicker: hex ⇄ HSV. Pure functions, no DOM.

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

/** "#abc", "abc", "#aabbcc" → "#aabbcc" (lower case), or null when it is not a color. */
export function parseHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return `#${h}`;
}

export function hexToHsv(hex: string): Hsv {
  const p = parseHex(hex) ?? "#000000";
  const r = parseInt(p.slice(1, 3), 16) / 255;
  const g = parseInt(p.slice(3, 5), 16) / 255;
  const b = parseInt(p.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** Readable text color (black / white) on top of `hex`. */
export function onColor(hex: string): string {
  const p = parseHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}
