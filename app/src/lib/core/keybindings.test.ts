import { describe, expect, it } from "vitest";
import { fromVsCode, importVsCode } from "./keybindings.ts";

describe("VS Code keybindings", () => {
  it("maps modifiers per platform", () => {
    expect(fromVsCode("cmd+shift+b", true)).toBe("mod+shift+b");
    expect(fromVsCode("ctrl+b", true)).toBe("ctrl+b");
    expect(fromVsCode("ctrl+k ctrl+s", false)).toBe("mod+k mod+s");
  });
  it("imports known commands only", () => {
    const known = (id: string) => ["snippet.insert:bold", "build.compile", "tab.close"].includes(id);
    const r = importVsCode(
      [
        { key: "cmd+b", command: "latex-workshop.bold" },
        { key: "cmd+alt+b", command: "latex-workshop.build" },
        { key: "cmd+w", command: "-workbench.action.closeActiveEditor" },
        { key: "cmd+j", command: "something.unknown" },
      ],
      known,
      true,
    );
    expect(r.changes).toEqual({ "snippet.insert:bold": "mod+b", "build.compile": "mod+alt+b", "tab.close": "" });
    expect(r.skipped).toBe(1);
  });
});
