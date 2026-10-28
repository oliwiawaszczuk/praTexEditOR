import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { commandCompletion } from "./complete.ts";

/** A view stand-in (no DOM in the test environment): state + dispatch is all snippet() needs. */
function accept(doc: string, name: string, pos = doc.length) {
  const view = {
    state: EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true)] }),
    dispatch(...specs: TransactionSpec[]) {
      this.state = this.state.update(...specs).state;
    },
  };
  const opt = commandCompletion(name)!;
  (opt.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view as unknown as EditorView, opt, doc.indexOf("\\"), pos);
  return { text: view.state.doc.toString(), cursor: view.state.selection.main.head };
}

describe("command completion", () => {
  it("adds braces and puts the cursor inside", () => {
    expect(accept("\\inpu", "input")).toEqual({ text: "\\input{}", cursor: 7 });
  });
  it("two-argument commands start in the first braces", () => {
    expect(accept("\\fra", "frac")).toEqual({ text: "\\frac{}{}", cursor: 6 });
  });
  it("does not double braces when editing an existing call", () => {
    const r = accept("\\inpu{a}", "input", 5);
    expect(r.text).toBe("\\input{a}");
  });
  it("commands without arguments stay bare", () => {
    expect(commandCompletion("alpha")!.apply).toBeUndefined();
  });
});
