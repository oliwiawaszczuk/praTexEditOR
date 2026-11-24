import { describe, expect, it } from "vitest";
import { refsIn } from "./bada.ts";

describe("refsIn", () => {
  it("finds praBada ids in a comment", () => {
    expect(refsIn("% wynik: [[EXP-0007]] i [[NOTE-0003]]")).toEqual(["EXP-0007", "NOTE-0003"]);
  });
  it("ignores LaTeX brackets and other text", () => {
    expect(refsIn("\\item[[a]] \\cite{EXP-0007} [[nope]]")).toEqual([]);
  });
});
