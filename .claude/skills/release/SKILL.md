# /release — Create a New Release

Create and publish a new TaWTUI release. The process is mostly automated via GitHub Actions — you just tag and push.

## Repos Involved

| Repo | Purpose |
|---|---|
| `victorstein/tawtui` | Main repo. Has `release.yml` workflow triggered by `v*` tags |
| `victorstein/homebrew-tap` | Homebrew formula. Has `update-formula.yml` triggered by repository dispatch from tawtui |

## Release Flow

```
1. Bump version in package.json
2. Commit + tag (v<version>)
3. Push tag → triggers .github/workflows/release.yml
4. CI builds binary + notification helper on macOS runner
5. CI creates GitHub Release with artifacts
6. CI dispatches to homebrew-tap → auto-updates formula version + SHA
7. Users run: brew upgrade tawtui
```

## Steps

### 1. Bump version

Update `version` in `package.json`:

```bash
# Edit package.json version field
# Then:
git add package.json
git commit -m "chore: bump version to <version>"
```

### 2. Tag and push

```bash
git tag v<version>
git push origin main --tags
```

This triggers the GitHub Action which handles everything else automatically.

### 3. Verify the release

```bash
# Check the GitHub Action completed
gh run list --workflow=release.yml --limit 1

# Check the release was created with artifacts
gh release view v<version>

# Check homebrew-tap was updated
gh api repos/victorstein/homebrew-tap/contents/Formula/tawtui.rb --jq '.content' | base64 -d | head -5
```

## What the CI Does (`.github/workflows/release.yml`)

1. Checks out code on `macos-latest`
2. Installs Bun
3. Runs `bun install`
4. Compiles binary via `scripts/compile.ts` → `dist/tawtui-darwin-arm64`
5. Builds notification helper via `src/notify-helper/build.sh` → `dist/TaWTUI Notify.app/`
6. Generates SHA-256 checksum
7. Creates GitHub Release with `softprops/action-gh-release` (auto-generates release notes)
8. Dispatches `update-formula` event to `victorstein/homebrew-tap` with the tag

## What the Tap CI Does (`homebrew-tap/.github/workflows/update-formula.yml`)

1. Receives `repository_dispatch` with `{ "tag": "v<version>" }`
2. Downloads checksum from the GitHub Release
3. Updates `version` and `sha256` in `Formula/tawtui.rb` via sed
4. Auto-commits and pushes

## Homebrew Formula (`Formula/tawtui.rb`)

The formula downloads the prebuilt binary from GitHub Releases and installs it to the Homebrew bin. It currently only installs the main binary — the notification helper `.app` bundle is not yet distributed via Homebrew.

## Local Build (for testing)

```bash
bun run build:release
```

Runs `scripts/build-release.sh` which:
1. **Quality gates** — lint, test, format check (stops on failure)
2. **Clean dist/** — removes previous build artifacts
3. **Compile binary** → `dist/tawtui-darwin-arm64`
4. **Build notification helper** → `dist/TaWTUI Notify.app/`
5. **Generate checksums**

Verify locally:
```bash
./dist/tawtui-darwin-arm64 --help
ls -la "dist/TaWTUI Notify.app/Contents/MacOS/tawtui-notify"
```

## Known Gaps

- **CI notification helper**: The release workflow needs to build the Swift notification helper (`src/notify-helper/build.sh`) — currently only builds the main binary
- **Homebrew formula**: Only installs the binary. Needs updating to also install `TaWTUI Notify.app` alongside it for notifications to work after `brew install`
- **Release assets**: The `.app` bundle should be uploaded as a release asset (tarball) so the Homebrew formula can download and install it

## Troubleshooting

- **CI fails on tag push**: Check `gh run list --workflow=release.yml` for logs
- **Tap not updated**: Verify `TAP_GITHUB_TOKEN` secret is set in the tawtui repo
- **Homebrew formula stale**: Manually run `gh api repos/victorstein/homebrew-tap/dispatches -f event_type=update-formula -f 'client_payload={"tag":"v<version>"}'`
- **Swift compile fails in CI**: The `macos-latest` runner includes Xcode — should work. Check runner logs.
