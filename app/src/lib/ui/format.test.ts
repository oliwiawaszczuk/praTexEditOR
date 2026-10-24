import { describe, expect, it } from "vitest";
import { ago, formatDuration, formatSize } from "./format.ts";

describe("ago", () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime();
  it("names recent days", () => {
    expect(ago(new Date(2026, 9, 23, 8, 0).getTime(), now)).toBe("dziś");
    expect(ago(new Date(2026, 9, 22, 23, 0).getTime(), now)).toBe("wczoraj");
    expect(ago(new Date(2026, 9, 18, 12, 0).getTime(), now)).toBe("5 d");
  });
  it("rounds longer spans", () => {
    expect(ago(now - 21 * 86_400_000, now)).toBe("3 tyg.");
    expect(ago(now - 100 * 86_400_000, now)).toBe("3 mies.");
    expect(ago(now - 800 * 86_400_000, now)).toBe("2 l.");
  });
});

describe("formatSize", () => {
  it("uses a decimal comma", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1,5 kB");
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MB");
  });
});

describe("formatDuration", () => {
  it("uses a decimal comma and minutes when long", () => {
    expect(formatDuration(1234)).toBe("1,2 s");
    expect(formatDuration(340)).toBe("0,3 s");
    expect(formatDuration(75_000)).toBe("1:15");
  });
});
