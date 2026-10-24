import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, onColor, parseHex } from "./color.ts";

describe("color", () => {
  it("parses short, long and bare hex", () => {
    expect(parseHex("#FA0")).toBe("#ffaa00");
    expect(parseHex("ffc951")).toBe("#ffc951");
    expect(parseHex(" #5B9BD5 ")).toBe("#5b9bd5");
    expect(parseHex("#12")).toBeNull();
    expect(parseHex("zzzzzz")).toBeNull();
  });

  it("round-trips through HSV", () => {
    for (const hex of ["#ffc951", "#5b9bd5", "#7bc47f", "#000000", "#ffffff", "#808080", "#ff0000"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("knows the primaries", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00").h).toBe(120);
    expect(hexToHsv("#0000ff").h).toBe(240);
  });

  it("picks a readable text color", () => {
    expect(onColor("#ffc951")).toBe("#111111");
    expect(onColor("#1b1b1b")).toBe("#ffffff");
  });
});
