# /release — Create a New Release

Create a release build and publish it.

## Prerequisites

Before releasing, ensure:
- All changes are committed (clean working tree)
- You're on the correct branch (usually `main`)
- All features have been tested manually

## Release Process

### 1. Build the release

```bash
bun run build:release
```

This runs `scripts/build-release.sh` which:
1. **Quality gates** — lint, test, format check (stops on failure)
2. **Clean dist/** — removes previous build artifacts
3. **Compile binary** — `scripts/compile.ts` builds `dist/tawtui-darwin-arm64` via Bun's native compiler
4. **Build notification helper** — `src/notify-helper/build.sh` compiles the Swift notification app to `dist/TaWTUI Notify.app/`
5. **Generate checksums** — SHA-256 for each binary

### 2. Verify the build

```bash
# Check binary runs
./dist/tawtui-darwin-arm64 --help

# Check notification helper is bundled
ls -la "dist/TaWTUI Notify.app/Contents/MacOS/tawtui-notify"

# Verify checksums
cat dist/*.sha256
```

### 3. Tag and push

```bash
# Bump version in package.json first
# Then tag:
git tag v<version>
git push origin v<version>
```

### 4. Create GitHub release

```bash
gh release create v<version> \
  dist/tawtui-darwin-arm64 \
  dist/tawtui-darwin-arm64.sha256 \
  --title "v<version>" \
  --notes "Release notes here"
```

Note: The `TaWTUI Notify.app` bundle needs to be included alongside the binary in the Homebrew formula installation step — it's not uploaded as a separate release asset. The formula should extract both from the tarball.

## Build Artifacts

| File | Description |
|---|---|
| `dist/tawtui-darwin-arm64` | Compiled Bun binary (macOS ARM64) |
| `dist/tawtui-darwin-arm64.sha256` | SHA-256 checksum |
| `dist/TaWTUI Notify.app/` | macOS notification helper (.app bundle) |

## Troubleshooting

- **Lint fails**: Run `bun run lint` to see errors, fix them first
- **Tests fail**: Run `bun run test` to see failures
- **Swift compile fails**: Ensure Xcode command line tools are installed (`xcode-select --install`)
- **Notification helper missing**: Run `bun run build:notify` separately to debug
