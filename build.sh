#!/usr/bin/env bash
# Local macOS build → praTexEditOR.app in the project root (data in
# ~/Library/Application Support/com.praoliwia.praTexEditOR, like a release).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/app"
DEST="$ROOT/praTexEditOR.app"

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
