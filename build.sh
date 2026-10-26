#!/usr/bin/env bash
# Local macOS build → praTexEditOR.app in the project root, then installed into
# /Applications (data in ~/Library/Application Support/com.praoliwia.praTexEditOR, like a
# release).
#   ./build.sh               build + install to /Applications (replaces the old copy)
#   ./build.sh --no-install  build only (praTexEditOR.app stays in the project root)
#   ./build.sh --install-only  copy the last build to /Applications (app must be closed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/app"
DEST="$ROOT/praTexEditOR.app"
INSTALLED="/Applications/praTexEditOR.app"
INSTALL=1
[ "${1:-}" = "--no-install" ] && INSTALL=0

if [ "${1:-}" = "--install-only" ]; then
  [ -d "$DEST" ] || { echo "Brak $DEST — najpierw ./build.sh"; exit 1; }
  pgrep -f "$INSTALLED/Contents/MacOS/" >/dev/null 2>&1 && { echo "⚠ Zamknij praTexEditOR (⌘Q) i spróbuj ponownie"; exit 1; }
  rm -rf "$INSTALLED"
  ditto "$DEST" "$INSTALLED"
  echo "✓ Zainstalowano: $INSTALLED"
  exit 0
fi

"$ROOT/scripts/fetch-tectonic.sh"
echo "▶ Budowanie praTexEditOR.app…"
cd "$APP"
[ -d node_modules ] || pnpm install --frozen-lockfile
pnpm tauri build --bundles app

echo "▶ Kopiowanie do roota projektu…"
rm -rf "$DEST"
cp -R "$APP/src-tauri/target/release/bundle/macos/praTexEditOR.app" "$DEST"
du -sh "$DEST"
echo "✓ Gotowe: $DEST"

if [ "$INSTALL" = 1 ]; then
  # An app that is running keeps its old files open: ask to quit it first.
  if pgrep -f "$INSTALLED/Contents/MacOS/" >/dev/null 2>&1; then
    echo "⚠ praTexEditOR jest uruchomiony — zamknij go (⌘Q) i uruchom: ./build.sh --install-only"
    exit 0
  fi
  echo "▶ Instalacja w /Applications…"
  rm -rf "$INSTALLED"
  ditto "$DEST" "$INSTALLED"
  echo "✓ Zainstalowano: $INSTALLED"
fi
