#!/usr/bin/env bash
# Builds the Windows NSIS installer from Linux. NSIS needs wine for the uninstaller,
# so the final step runs inside electron-builder's wine image.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(cd ../.. && pwd)"
wine_home="${XDG_CACHE_HOME:-$HOME/.cache}/alma-term/winehome"
mkdir -p "$wine_home" "$HOME/.cache/electron-builder"

pnpm exec electron-vite build
pnpm exec electron-builder --win --x64 --dir
docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/winehome -e ELECTRON_BUILDER_CACHE=/cache \
  -v "$wine_home:/winehome" -v "$HOME/.cache/electron-builder:/cache" \
  -v "$root:$root" -w "$root/apps/desktop" \
  electronuserland/builder:24-wine-05.26 \
  node node_modules/electron-builder/cli.js --win nsis --x64 --prepackaged release/win-unpacked
