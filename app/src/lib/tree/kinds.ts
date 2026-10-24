// File kind → pictogram + colour token (docs/design/ui-tokens.md).

import type { IconName } from "#lib/ui/Icon.svelte";

export type FileKind = "tex" | "bib" | "img" | "pdf" | "data" | "other";

const EXT: Record<string, FileKind> = {
  tex: "tex", sty: "tex", cls: "tex", ltx: "tex", dtx: "tex", ins: "tex", bbx: "tex", cbx: "tex",
  bib: "bib",
  png: "img", jpg: "img", jpeg: "img", gif: "img", svg: "img", eps: "img", webp: "img", tif: "img", tiff: "img", bmp: "img",
  pdf: "pdf",
  csv: "data", tsv: "data", dat: "data", txt: "data", json: "data", xlsx: "data",
};

export function fileKind(name: string): FileKind {
  const i = name.lastIndexOf(".");
  return i > 0 ? (EXT[name.slice(i + 1).toLowerCase()] ?? "other") : "other";
}

export const KIND_ICON: Record<FileKind, IconName> = {
  tex: "tex",
  bib: "bib",
  img: "image",
  pdf: "pdf",
  data: "data",
  other: "file",
};

export const kindColor = (k: FileKind): string => `var(--file-${k})`;
