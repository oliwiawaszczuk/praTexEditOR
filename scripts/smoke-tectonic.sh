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
# The first compile downloads Tectonic's package bundle; a CI runner's network hiccup
# ("error decoding response body") must not fail the whole run, so retry a few times.
ok=0
for attempt in 1 2 3 4; do
  if (cd "$DIR" && "$BIN" -X compile main.tex --outdir out --keep-intermediates --keep-logs --synctex); then
    ok=1
    break
  fi
  echo "⚠ próba $attempt/4 nieudana — ponawiam za $((attempt * 15)) s" >&2
  sleep $((attempt * 15))
done
[ "$ok" = 1 ] || { echo "✗ kompilacja nie powiodła się (sieć lub pakiety)" >&2; exit 1; }
for f in main.pdf main.synctex.gz main.log; do
  [ -s "$DIR/out/$f" ] || { echo "✗ brak $f" >&2; exit 1; }
done
echo "✓ Tectonic kompiluje ($(wc -c < "$DIR/out/main.pdf") B PDF)"
