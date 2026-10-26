#!/usr/bin/env bash
# Synthetic project for the budgets in docs/02-plan.md §11: 50 chapters (~200 pages),
# 100 images, a .bib. Usage: scripts/bench/gen-project.sh [target-dir]
set -euo pipefail
out="${1:-${TMPDIR:-/tmp}/pratex-bench}"
rm -rf "$out"; mkdir -p "$out/rozdzialy" "$out/img"
for i in $(seq -w 1 100); do
  printf 'P3 8 8 255\n' > "$out/img/obraz-$i.ppm"
  for p in $(seq 1 64); do printf '%d %d %d\n' $((10#$i*2)) $((p*3)) 120 >> "$out/img/obraz-$i.ppm"; done
done
{ echo '@book{kn1, author={Knuth, Donald}, title={The TeXbook}, year={1984}}'; } > "$out/lit.bib"
{
  echo '\documentclass{book}'
  echo '\usepackage[utf8]{inputenc}\usepackage[T1]{fontenc}\usepackage[polish]{babel}'
  echo '\begin{document}\tableofcontents'
  for c in $(seq -w 1 50); do echo "\\input{rozdzialy/r$c}"; done
  echo '\end{document}'
} > "$out/main.tex"
for c in $(seq -w 1 50); do
  {
    echo "\\chapter{Rozdział $c}\\label{ch:$c}"
    for p in $(seq 1 12); do
      echo "\\section{Sekcja $p}"
      for k in 1 2 3 4 5 6; do echo "Zażółć gęślą jaźń, lorem ipsum dolor sit amet, consectetur adipiscing elit \\cite{kn1}. Wzór: \$a^2+b^2=c^2\$."; echo; done
    done
  } > "$out/rozdzialy/r$c.tex"
done
echo "$out"
