import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "./colors.ts";

describe("color swatches in code", () => {
  it("reads HTML, RGB and rgb values", () => {
    expect(toHex("HTML", "F4F5EF")).toBe("#f4f5ef");
    expect(toHex("HTML", "F4F5E")).toBeNull();
    expect(toHex("RGB", "244, 245, 239")).toBe("#f4f5ef");
    expect(toHex("RGB", "300,0,0")).toBeNull();
    expect(toHex("rgb", "1,0.5,0")).toBe("#ff8000");
    expect(toHex("rgb", "2,0,0")).toBeNull();
  });

  it("writes back in the original style", () => {
    expect(fromHex("HTML", "#c0392b", "F4F5EF")).toBe("C0392B");
    expect(fromHex("HTML", "#c0392b", "f4f5ef")).toBe("c0392b");
    expect(fromHex("RGB", "#f4f5ef", "1, 2, 3")).toBe("244, 245, 239");
    expect(fromHex("RGB", "#f4f5ef", "1,2,3")).toBe("244,245,239");
    expect(fromHex("rgb", "#ff8000", "0,0,0")).toBe("1,0.502,0");
  });
});
