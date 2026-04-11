#!/bin/bash
# Build the TaWTUI notification helper .app bundle
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/dist/TaWTUI Notify.app"

# Create .app bundle structure
mkdir -p "$BUILD_DIR/Contents/MacOS"
mkdir -p "$BUILD_DIR/Contents/Resources"

# Copy Info.plist and icon
cp "$SCRIPT_DIR/Info.plist" "$BUILD_DIR/Contents/Info.plist"
cp "$SCRIPT_DIR/AppIcon.icns" "$BUILD_DIR/Contents/Resources/AppIcon.icns"

# Compile Swift source
swiftc "$SCRIPT_DIR/notify.swift" \
  -o "$BUILD_DIR/Contents/MacOS/tawtui-notify" \
  -framework Cocoa \
  -framework UserNotifications \
  -O

# Ad-hoc code sign
codesign --force --sign - "$BUILD_DIR"

echo "Built: $BUILD_DIR"
