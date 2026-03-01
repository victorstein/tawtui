#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
ENTRY="$ROOT_DIR/src/main.ts"

echo "==> Running quality gates..."
cd "$ROOT_DIR"
bun run lint
bun run test
bun run format --check

echo ""
echo "==> Cleaning dist/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "==> Building darwin-arm64..."
bun build --compile --target=bun-darwin-arm64 "$ENTRY" --outfile "$DIST_DIR/tawtui-darwin-arm64"

echo "==> Building darwin-x64..."
bun build --compile --target=bun-darwin-x64 "$ENTRY" --outfile "$DIST_DIR/tawtui-darwin-x64"

echo ""
echo "==> Generating checksums..."
cd "$DIST_DIR"
shasum -a 256 tawtui-darwin-arm64 > tawtui-darwin-arm64.sha256
shasum -a 256 tawtui-darwin-x64 > tawtui-darwin-x64.sha256

echo ""
echo "==> Build complete!"
ls -lh "$DIST_DIR"/tawtui-*
echo ""
cat "$DIST_DIR"/*.sha256
