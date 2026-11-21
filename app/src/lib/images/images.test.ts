import { describe, expect, it } from "vitest";
import { imageCode, relPath, slug, studiaFigure } from "./images.svelte.ts";
import { toTemplate } from "#lib/snippets/vscode.ts";

describe("images", () => {
  it("relative paths from the main file's folder", () => {
    expect(relPath("/Users/ola/Praca", "/Users/ola/Praca/img/a.png")).toBe("img/a.png");
    expect(relPath("/Users/ola/Praca/tex", "/Users/ola/Praca/img/a.png")).toBe("../img/a.png");
    expect(relPath("C:\\Praca", "C:\\Praca\\img\\a.png")).toBe("img/a.png");
  });
  it("safe names and labels", () => {
    expect(slug("Wykres 3 (kopia).png")).toBe("wykres-3-kopia");
    expect(slug("Zażółć.PNG")).toBe("zazolc");
  });
  it("code: plain or a figure with the cursor in the caption", () => {
    expect(toTemplate(imageCode("img/a b$.png", "plain", "a"))).toBe("\\includegraphics[width=${1:0.8}\\textwidth]{img/a b$.png}${0}");
    const fig = toTemplate(imageCode("img/wykres.png", "figure", "wykres"));
    expect(fig).toContain("\\includegraphics[width=0.8\\textwidth]{img/wykres.png}");
    expect(fig).toContain("\\caption{${1}}");
    expect(fig).toContain("\\label{fig:wykres}");
  });
  it("Studia: figure[H] with the caption centered and tab stops", () => {
    const t = toTemplate(imageCode("images/zrzut a.png", "figure", "zrzut-a", true));
    expect(t).toBe(
      "\\begin{figure}[H]\n    \\centering\n    \\includegraphics[width=${1:0.8}\\textwidth, clip]{images/zrzut a.png}\n    \\caption{\\centering ${2}}\n    \\label{fig:${3:zrzut-a}}\n\\end{figure}${0}",
    );
    expect(studiaFigure("images/a.png", "a")).toContain("{images/a.png}");
    expect(imageCode("images/a.png", "plain", "a", true)).toContain("\\includegraphics[width=${1:0.8}\\textwidth]{images/a.png}");
  });
});
