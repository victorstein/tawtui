#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

echo "==> Running quality gates..."
cd "$ROOT_DIR"
bun run lint
bun run test -- --passWithNoTests
bun run format -- --check --no-error-on-unmatched-pattern

echo ""
echo "==> Cleaning dist/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

bun run "$ROOT_DIR/scripts/compile.ts"

echo ""
echo "==> Generating checksums..."
cd "$DIST_DIR"
for bin in tawtui-darwin-*; do
  [[ "$bin" == *.sha256 ]] && continue
  shasum -a 256 "$bin" > "$bin.sha256"
done

echo ""
echo "==> Build complete!"
ls -lh "$DIST_DIR"/tawtui-*
echo ""
cat "$DIST_DIR"/*.sha256
