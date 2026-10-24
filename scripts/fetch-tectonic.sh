#!/usr/bin/env bash
# Download the pinned Tectonic CLI for one target into app/src-tauri/binaries/
# as tectonic-<target-triple>[.exe] — the name Tauri's `externalBin` expects.
#
#   ./scripts/fetch-tectonic.sh            # host target (rustc -vV)
#   ./scripts/fetch-tectonic.sh <triple>   # explicit target (CI)
set -euo pipefail

VERSION="0.17.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/app/src-tauri/binaries"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"

# Our triple → the asset Tectonic publishes. Linux uses the static musl build:
# no system ICU/HarfBuzz/fontconfig needed, so it runs inside AppImage/deb anywhere.
case "$TRIPLE" in
  aarch64-apple-darwin | x86_64-apple-darwin) ASSET="tectonic-$VERSION-$TRIPLE.tar.gz" ;;
  x86_64-unknown-linux-gnu) ASSET="tectonic-$VERSION-x86_64-unknown-linux-musl.tar.gz" ;;
  aarch64-unknown-linux-gnu) ASSET="tectonic-$VERSION-aarch64-unknown-linux-musl.tar.gz" ;;
  x86_64-pc-windows-msvc) ASSET="tectonic-$VERSION-x86_64-pc-windows-msvc.zip" ;;
  *) echo "✗ brak binarki Tectonic dla $TRIPLE" >&2; exit 1 ;;
esac

EXT=""
[[ "$TRIPLE" == *windows* ]] && EXT=".exe"
OUT="$DEST/tectonic-$TRIPLE$EXT"
STAMP="$OUT.version"
if [[ -f "$OUT" && "$(cat "$STAMP" 2>/dev/null)" == "$VERSION" ]]; then
  echo "✓ Tectonic $VERSION już jest: $OUT"
  exit 0
fi

URL="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40$VERSION/$ASSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "▶ Pobieranie ${ASSET}…"
curl -fsSL --retry 3 -o "$TMP/$ASSET" "$URL"
case "$ASSET" in
  *.zip) (cd "$TMP" && unzip -q "$ASSET") ;;
  *) tar -xzf "$TMP/$ASSET" -C "$TMP" ;;
esac

mkdir -p "$DEST"
mv "$TMP/tectonic$EXT" "$OUT"
chmod +x "$OUT"
echo "$VERSION" > "$STAMP"
echo "✓ $OUT"
