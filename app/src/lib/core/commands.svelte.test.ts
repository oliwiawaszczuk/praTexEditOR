import { describe, expect, it } from "vitest";
import { conflicts, dispatchKey, keysOf, matches, register, setOverrides, strokeOf, toCmKey } from "./commands.svelte.ts";

const key = (init: KeyboardEventInit & { code?: string; defaultPrevented?: boolean }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  key: "",
  code: "",
  defaultPrevented: false,
  preventDefault() {
    (this as { defaultPrevented: boolean }).defaultPrevented = true;
  },
  stopPropagation() {},
  target: null,
  isComposing: false,
  ...init,
}) as unknown as KeyboardEvent;

describe("commands", () => {
  it("converts bindings to CodeMirror keys", () => {
    expect(toCmKey("mod+shift+p")).toBe("Mod-Shift-p");
    expect(toCmKey("alt+z")).toBe("Alt-z");
    expect(toCmKey("f8")).toBe("F8");
    expect(toCmKey("ctrl+tab")).toBe("Ctrl-Tab");
  });

  it("matches by code, so ⌥ symbols on macOS still hit", () => {
    expect(matches(key({ metaKey: true, altKey: true, key: "¡", code: "Digit1" }), "mod+alt+1", true)).toBe(true);
    expect(matches(key({ metaKey: true, key: "w", code: "KeyW" }), "mod+w", true)).toBe(true);
    expect(matches(key({ ctrlKey: true, key: "w", code: "KeyW" }), "mod+w", true)).toBe(false);
    expect(matches(key({ ctrlKey: true, key: "w", code: "KeyW" }), "mod+w", false)).toBe(true);
    expect(matches(key({ metaKey: true, shiftKey: true, key: "W", code: "KeyW" }), "mod+w", true)).toBe(false);
    expect(matches(key({ ctrlKey: true, key: "Tab", code: "Tab" }), "ctrl+tab", true)).toBe(true);
  });

  it("dispatches by binding, overrides and chords", () => {
    let n = 0;
    let m = 0;
    const off = register([
      { id: "t.x", title: "x", keys: "mod+s", run: () => void n++ },
      { id: "t.chord", title: "c", keys: "mod+k mod+s", run: () => void m++ },
    ]);
    expect(dispatchKey(key({ metaKey: true, key: "s", code: "KeyS" }), true)).toBe(true);
    expect(n).toBe(1);
    // Chord: first stroke waits, the second runs it.
    expect(dispatchKey(key({ metaKey: true, key: "k", code: "KeyK" }), true)).toBe(true);
    expect(dispatchKey(key({ metaKey: true, key: "s", code: "KeyS" }), true)).toBe(true);
    expect(m).toBe(1);
    expect(n).toBe(1);
    // User override: x moves to ⌘⇧S, ⌘S does nothing now.
    setOverrides({ "t.x": "mod+shift+s" });
    expect(keysOf("t.x")).toBe("mod+shift+s");
    expect(dispatchKey(key({ metaKey: true, key: "s", code: "KeyS" }), true)).toBe(false);
    expect(dispatchKey(key({ metaKey: true, shiftKey: true, key: "S", code: "KeyS" }), true)).toBe(true);
    expect(n).toBe(2);
    setOverrides({ "t.x": "" });
    expect(keysOf("t.x")).toBeUndefined();
    setOverrides({});
    off();
    expect(dispatchKey(key({ metaKey: true, key: "s", code: "KeyS" }), true)).toBe(false);
  });

  it("finds clashes, also with a chord's first stroke", () => {
    const off = register([
      { id: "a", title: "a", keys: "mod+b", when: "editorFocus", run: () => {} },
      { id: "b", title: "b", keys: "mod+k mod+s", run: () => {} },
      { id: "c", title: "c", keys: "mod+t", when: "treeFocus", run: () => {} },
    ]);
    expect(conflicts("z", "mod+b", "editorFocus").map((c) => c.id)).toEqual(["a"]);
    expect(conflicts("z", "mod+k").map((c) => c.id)).toEqual(["b"]);
    expect(conflicts("z", "mod+t", "editorFocus")).toEqual([]);
    off();
  });

  it("records strokes", () => {
    expect(strokeOf(key({ metaKey: true, shiftKey: true, key: "P", code: "KeyP" }), true)).toBe("mod+shift+p");
    expect(strokeOf(key({ metaKey: true, altKey: true, key: "¡", code: "Digit1" }), true)).toBe("mod+alt+1");
    expect(strokeOf(key({ key: "F8", code: "F8" }), true)).toBe("f8");
    expect(strokeOf(key({ metaKey: true, key: ".", code: "Period" }), true)).toBe("mod+.");
    expect(strokeOf(key({ key: "Shift", code: "ShiftLeft", shiftKey: true }), true)).toBeNull();
  });
});
