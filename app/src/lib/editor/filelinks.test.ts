import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { fileLinkAt } from "./filelinks.ts";

const state = (doc: string) => EditorState.create({ doc });

describe("file links in code", () => {
  const doc = "\\input{content/Wprowadzenie}\n\\includegraphics[width=5cm]{img/a.png}\n\\bibliography{one, two}\n% \\input{ukryte}\n";
  const s = state(doc);

  it("finds the path under the cursor", () => {
    const at = doc.indexOf("Wprowadzenie");
    expect(fileLinkAt(s, at)).toMatchObject({ kind: "tex", arg: "content/Wprowadzenie" });
    expect(fileLinkAt(s, doc.indexOf("a.png"))).toMatchObject({ kind: "image", arg: "img/a.png" });
  });

  it("splits \\bibliography into items", () => {
    expect(fileLinkAt(s, doc.indexOf("one"))).toMatchObject({ kind: "bib", arg: "one" });
    expect(fileLinkAt(s, doc.indexOf("two"))).toMatchObject({ kind: "bib", arg: "two" });
  });

  it("ignores the command name and comments", () => {
    expect(fileLinkAt(s, 2)).toBeNull();
    expect(fileLinkAt(s, doc.indexOf("ukryte"))).toBeNull();
  });
});
