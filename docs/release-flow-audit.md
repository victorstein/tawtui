# Release Flow Audit

> Audited 2026-04-14 against tawtui@0.2.0 (local) / homebrew-tap@0.2.6

## Complete Release Flow

```
Developer                   GitHub Actions (tawtui)              GitHub Actions (homebrew-tap)
─────────                   ───────────────────────              ────────────────────────────
1. Bump version in
   package.json

2. git commit + tag v<ver>

3. git push --tags
        │
        ▼
                            4. release.yml triggers on v* tag
                            5. Checkout + bun install
                            6. Build binary (compile.ts)
                               → dist/tawtui-darwin-arm64
                            7. Build notification helper (build.sh)
                               → dist/TaWTUI Notify.app/
                            8. Package helper as tarball
                               → dist/tawtui-notify-darwin-arm64.tar.gz
                            9. Generate SHA256 checksums (×2)
                            10. Create GitHub Release
                                (uploads 4 artifacts)
                            11. repository_dispatch to
                                victorstein/homebrew-tap
                                    │
                                    ▼
                                                                 12. update-formula.yml triggers
                                                                 13. Download checksum files from
                                                                     the GitHub Release via curl
                                                                 14. sed-patch Formula/tawtui.rb:
                                                                     - version
                                                                     - binary sha256
                                                                     - notify-helper sha256
                                                                 15. git commit + push
                                                                         │
                                                                         ▼
                                                                 Users: brew upgrade tawtui
```

### Artifacts Uploaded to GitHub Release

| File | Purpose |
|---|---|
| `tawtui-darwin-arm64` | Main binary (arm64 macOS) |
| `tawtui-darwin-arm64.sha256` | Checksum for binary |
| `tawtui-notify-darwin-arm64.tar.gz` | Notification helper .app bundle |
| `tawtui-notify-darwin-arm64.tar.gz.sha256` | Checksum for helper tarball |

### What `brew install victorstein/tap/tawtui` Does

1. Downloads `tawtui-darwin-arm64` from the GitHub Release
2. Verifies SHA256 against the formula
3. Downloads `tawtui-notify-darwin-arm64.tar.gz` as a resource
4. Verifies its SHA256 against the formula
5. Installs binary to `$(brew --prefix)/bin/tawtui`
6. Extracts and installs notification helper to `$(brew --prefix)/Cellar/tawtui/<ver>/libexec/TaWTUI Notify.app`

---

## Repos Involved

| Repo | Key Files | Current State |
|---|---|---|
| `victorstein/tawtui` | `.github/workflows/release.yml`, `scripts/compile.ts`, `scripts/build-release.sh`, `src/notify-helper/build.sh` | Source of truth for code + CI release |
| `victorstein/homebrew-tap` | `Formula/tawtui.rb`, `.github/workflows/update-formula.yml` | Source of truth for Homebrew formula |
| Local `homebrew-formula/tawtui.rb` | Reference copy in tawtui repo | **Stale** — see issue #1 |

---

## Failure Points

### CRITICAL — Will break brew install

#### 1. Notification helper SHA is `PLACEHOLDER_NOTIFY_SHA256`

**Where:** `victorstein/homebrew-tap` → `Formula/tawtui.rb` line in the `resource "notify-helper"` block

**Problem:** The current live formula at v0.2.6 has `sha256 "PLACEHOLDER_NOTIFY_SHA256"` for the notify-helper resource. This means either:
- The sed replacement in `update-formula.yml` failed silently on the last release, OR
- The notify-helper tarball checksum file wasn't available when the tap workflow ran

**Impact:** `brew install victorstein/tap/tawtui` will fail on the resource checksum verification step. The main binary installs fine, but the notification helper does not.

**Root cause candidates:**
- The `curl -sL` in the tap workflow suppresses errors (`-s` flag). If the checksum file doesn't exist or the CDN hasn't propagated yet, `curl` returns empty content, `awk` outputs nothing, and sed writes an empty string — or the placeholder persists if the download returned an HTML error page that awk couldn't parse.
- There's no validation that the downloaded checksum is actually a valid hex string before patching the formula.

**Fix:** Add error checking after the curl downloads in `update-formula.yml` — verify the checksum files contain valid SHA256 hex strings before proceeding.

---

#### 2. Silent checksum download failure (race condition / CDN lag)

**Where:** `victorstein/homebrew-tap` → `.github/workflows/update-formula.yml`, step "Get release info"

**Problem:** The workflow downloads checksums via raw curl from GitHub Releases:
```bash
curl -sL "https://github.com/victorstein/tawtui/releases/download/${TAG}/tawtui-darwin-arm64.sha256" -o checksum.txt
```
The `-s` (silent) flag means a 404, timeout, or partial download produces no error. The workflow continues with garbage or empty data.

**Scenario:** The `repository_dispatch` fires immediately after the release is created by `softprops/action-gh-release`. GitHub's CDN may not have all assets available instantly. A few-second delay could mean the checksum file returns 404.

**Impact:** Formula gets patched with an empty or invalid SHA256. All brew installs fail until manually fixed.

**Fix:** Add retry logic with validation, or use `gh release download` instead of raw curl (the GitHub CLI respects the release API, not the CDN).

---

### HIGH — Likely to cause a broken release

#### 3. Runner architecture mismatch

**Where:** `tawtui` → `.github/workflows/release.yml` line 13: `runs-on: macos-latest`

**Problem:** `compile.ts` hardcodes `target: 'bun-darwin-arm64'` (Bun cross-compiles, so this is fine for the binary). But `src/notify-helper/build.sh` runs `swiftc` without specifying a target architecture — it compiles for whatever the host runner is.

GitHub's `macos-latest` label has been transitioning from Intel to Apple Silicon. If the runner is Intel, the Swift binary is compiled for x86_64 while the main binary is arm64. Users get a mixed-architecture release.

**Impact:** Notification helper crashes or doesn't launch on Apple Silicon Macs.

**Fix:** Either:
- Pin to `macos-15` or `macos-latest-xlarge` (guaranteed arm64), or
- Add `-target arm64-apple-macos13` to the `swiftc` invocation in `build.sh`

---

#### 4. CI skips quality gates

**Where:** `tawtui` → `.github/workflows/release.yml`

**Problem:** The CI workflow runs zero tests, zero lint, zero format checks. The local `build-release.sh` runs all three as a prerequisite, but CI does not.

**Impact:** A tagged release can ship code that fails tests or has lint errors. The quality gates only protect manual local builds.

**Fix:** Add a quality gate step before the build steps in `release.yml`, or require a passing CI check before the tag is pushed (branch protection).

---

#### 5. sed-based formula patching is fragile

**Where:** `victorstein/homebrew-tap` → `.github/workflows/update-formula.yml`, step "Update formula"

**Problem:** The workflow uses three separate sed commands to patch the formula:
```bash
# version — straightforward
sed -i "s/version \".*\"/version \"${VERSION}\"/"
# binary sha256 — "first occurrence"
sed -i "0,/sha256 \".*\"/{s/sha256 \".*\"/sha256 \"${SHA256}\"/}"
# notify sha256 — within resource block
sed -i "/resource \"notify-helper\"/,/end/{s/sha256 \".*\"/sha256 \"${NOTIFY_SHA256}\"/}"
```

The second sed uses `0,/pattern/` (GNU sed "first match" syntax) — this works on Linux (Ubuntu runner) but would fail on macOS sed. Since the tap workflow runs on `ubuntu-latest`, it's fine now, but it's a portability trap if the runner ever changes.

More critically: if the formula structure changes (e.g., adding a second resource, reordering fields), these sed patterns could match the wrong lines.

**Impact:** Silent corruption of the formula file.

**Fix:** Consider using a templating approach or `yq`/`ruby -e` for structured edits instead of sed.

---

### MEDIUM — Won't break the release but cause problems

#### 6. Local formula copy is stale and misleading

**Where:** `tawtui` → `homebrew-formula/tawtui.rb`

**Problem:** The local copy is at v0.1.0 with `PLACEHOLDER_SHA256` and doesn't have the `resource "notify-helper"` block. The real formula in the tap repo is at v0.2.6 with the resource block.

**Impact:** Anyone reading the local copy (including AI agents) will draw wrong conclusions about the Homebrew install behavior. It's actively misleading.

**Fix:** Either keep it in sync (add it to the release flow) or delete it and reference the tap repo as the source of truth.

---

#### 7. No runtime path discovery for the notification helper

**Where:** `tawtui` main binary → needs to find `TaWTUI Notify.app` at runtime

**Problem:** The formula installs the .app to `$(brew --prefix)/Cellar/tawtui/<ver>/libexec/TaWTUI Notify.app`. The main binary needs to know this path. There's no convention established — the binary presumably searches relative to itself or uses a hardcoded path.

**Impact:** If the binary expects the .app in a different location (e.g., `~/.local/share/tawtui/` or next to the binary), notifications silently fail after brew install.

**Needs verification:** Check how `notification.service.ts` locates the helper binary.

---

#### 8. Info.plist version hardcoded to 1.0

**Where:** `src/notify-helper/Info.plist` → `CFBundleVersion` and `CFBundleShortVersionString`

**Problem:** Both are hardcoded to `1.0` and never updated during the release process. macOS uses these for notification grouping and permission tracking.

**Impact:** Low — unlikely to cause user-visible issues, but technically incorrect metadata.

---

#### 9. Ad-hoc code signing

**Where:** `src/notify-helper/build.sh` line 25: `codesign --force --sign -`

**Problem:** Ad-hoc signature (no developer identity). macOS Gatekeeper may flag the app as unverified. Since Homebrew extracts it to `libexec/` (not user-downloaded), the quarantine bit is typically not set — but edge cases exist (e.g., `brew install` from a terminal that has quarantine attributes).

**Impact:** Users may see a "damaged app" dialog and need to run `xattr -cr` manually.

---

#### 10. No dispatch failure detection

**Where:** `tawtui` → `.github/workflows/release.yml`, step "Update Homebrew tap"

**Problem:** If `TAP_GITHUB_TOKEN` is expired, revoked, or the dispatch fails for any reason, the release goes out but Homebrew is never updated. There's no notification or retry.

**Impact:** Users on Homebrew stay on an old version indefinitely until someone notices.

**Fix:** Add a follow-up step that polls the tap repo for the commit (or checks the dispatch response status).

---

## Recommended Priority

1. **Fix the PLACEHOLDER_NOTIFY_SHA256** — brew install is broken right now for the notify helper
2. **Add checksum download validation** in tap workflow — prevent silent corruption
3. **Pin runner architecture** or add `-target` to swiftc — prevent mixed-arch builds
4. **Add quality gates to CI** — prevent shipping broken code
5. **Delete or sync local formula copy** — prevent confusion
6. **Verify runtime path discovery** — ensure brew-installed binary can find the .app
