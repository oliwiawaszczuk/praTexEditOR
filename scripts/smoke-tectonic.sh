#!/usr/bin/env bash
# Compile a tiny Polish document with the given Tectonic binary and check the PDF.
#   ./scripts/smoke-tectonic.sh <path-to-tectonic>
set -euo pipefail

BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
cat > "$DIR/main.tex" <<'TEX'
\documentclass{article}
\usepackage[polish]{babel}
\begin{document}
Hello, świat! Zażółć gęślą jaźń.
\end{document}
TEX
"$BIN" --version
mkdir -p "$DIR/out"
(cd "$DIR" && "$BIN" -X compile main.tex --outdir out --keep-intermediates --keep-logs --synctex)
for f in main.pdf main.synctex.gz main.log; do
  [ -s "$DIR/out/$f" ] || { echo "✗ brak $f" >&2; exit 1; }
done
echo "✓ Tectonic kompiluje ($(wc -c < "$DIR/out/main.pdf") B PDF)"
