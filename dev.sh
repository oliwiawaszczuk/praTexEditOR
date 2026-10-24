#!/usr/bin/env bash
# praTexEditOR dev mode: Vite hot reload + Tauri. Data in <app data>/com.praoliwia.praTexEditOR.dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
"$ROOT/scripts/fetch-tectonic.sh"
cd "$ROOT/app"
[ -d node_modules ] || pnpm install --frozen-lockfile

echo "▶ praTexEditOR dev (Ctrl+C aby zatrzymać)"
pnpm tauri dev
