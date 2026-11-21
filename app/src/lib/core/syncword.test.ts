import { describe, expect, it } from "vitest";
import { findInPieces, fold, locateInSource, occurrences, ordinalInPieces, wordAt, wordInSource, type Piece } from "./syncword.ts";

describe("fold", () => {
  it("folds case, Polish accents and ligatures, keeping a map to the input", () => {
    expect(fold("Źródło").text).toBe("zrodło");
    const f = fold("ﬁlm");
    expect(f.text).toBe("film");
    expect(f.map).toEqual([0, 0, 1, 2]);
  });
});

describe("occurrences", () => {
  it("finds whole words only", () => {
    expect(occurrences("kot kotek kot", "kot")).toEqual([
      [0, 3],
      [10, 13],
    ]);
  });
  it("skips macro names in source", () => {
    expect(occurrences("\\emph{emph} emph", "emph", true)).toEqual([
      [6, 10],
      [12, 16],
    ]);
  });
  it("matches across a ligature and accents", () => {
    expect(occurrences("the ﬁrst", "first")).toEqual([[4, 8]]);
    expect(occurrences("Zażółć gęślą", "zazołc")).toEqual([[0, 6]]);
  });
});

describe("wordInSource", () => {
  const line = "To jest \\textbf{ważne} i to jest ważne.";
  it("gives the word under the cursor and its ordinal", () => {
    expect(wordInSource(line, 18)).toEqual({ word: "ważne", ordinal: 0 });
    expect(wordInSource(line, 35)).toEqual({ word: "ważne", ordinal: 1 });
  });
  it("takes the word just before the cursor", () => {
    expect(wordInSource(line, 7)).toEqual({ word: "jest", ordinal: 0 });
  });
  it("gives nothing on a macro name or between words", () => {
    expect(wordInSource(line, 11)).toBeNull();
    expect(wordInSource("a  b", 2)).toBeNull();
  });
});

describe("wordAt", () => {
  it("expands to the word around an offset", () => {
    expect(wordAt("ala ma kota", 8)).toEqual({ word: "kota", from: 7, to: 11 });
  });
});

describe("locateInSource", () => {
  const lines = [
    { n: 9, text: "kot" },
    { n: 10, text: "pies i pies" },
    { n: 11, text: "ryba kot" },
  ];
  it("uses the ordinal on the SyncTeX line", () => {
    expect(locateInSource(lines, 10, { word: "pies", ordinal: 1 })).toEqual({ n: 10, from: 7, to: 11 });
    expect(locateInSource(lines, 10, { word: "pies", ordinal: 5 })).toEqual({ n: 10, from: 7, to: 11 });
  });
  it("falls back to the neighbours, above first", () => {
    expect(locateInSource(lines, 10, { word: "kot", ordinal: 0 })).toEqual({ n: 9, from: 0, to: 3 });
    expect(locateInSource(lines, 10, { word: "ryba", ordinal: 0 })).toEqual({ n: 11, from: 0, to: 4 });
    expect(locateInSource(lines, 10, { word: "koń", ordinal: 0 })).toBeNull();
  });
});

describe("pieces", () => {
  const pieces: Piece[] = [
    { text: "To jest pierw", end: "" },
    { text: "sze zda-", end: "eol" },
    { text: "nie i zdanie.", end: "" },
  ];
  it("finds words split over pieces and hyphenated lines", () => {
    expect(findInPieces(pieces, "pierwsze", 0)).toEqual({ from: [0, 8], to: [1, 3] });
    expect(findInPieces(pieces, "zdanie", 0)).toEqual({ from: [1, 4], to: [2, 3] });
    expect(findInPieces(pieces, "zdanie", 1)).toEqual({ from: [2, 6], to: [2, 12] });
    expect(findInPieces(pieces, "brak", 0)).toBeNull();
  });
  it("counts occurrences before a position", () => {
    expect(ordinalInPieces(pieces, "zdanie", 2, 6)).toBe(1);
    expect(ordinalInPieces(pieces, "zdanie", 1, 4)).toBe(0);
  });
  it("does not glue pieces separated by a line end or a gap", () => {
    expect(findInPieces([{ text: "ab", end: "gap" }, { text: "cd", end: "" }], "abcd", 0)).toBeNull();
  });
});
