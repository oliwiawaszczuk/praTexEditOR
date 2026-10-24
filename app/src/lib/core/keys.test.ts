import { describe, expect, it } from "vitest";
import { formatKeys } from "./keys.ts";

describe("formatKeys", () => {
  it("uses symbols on macOS", () => {
    expect(formatKeys("mod+shift+p", true)).toBe("⌘⇧P");
    expect(formatKeys("mod+enter", true)).toBe("⌘↵");
    expect(formatKeys("f8", true)).toBe("F8");
  });
  it("uses names elsewhere", () => {
    expect(formatKeys("mod+shift+p", false)).toBe("Ctrl+Shift+P");
    expect(formatKeys("alt+up", false)).toBe("Alt+↑");
  });
  it("formats chords", () => {
    expect(formatKeys("mod+k mod+s", true)).toBe("⌘K ⌘S");
  });
});
