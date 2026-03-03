---
allowed-tools: Bash(git:*), Bash(gh:*)
argument-hint: "[version]"
---

# /release — Create a New Release

Merge the current branch to main, tag, and trigger the CI release workflow.

## Prerequisites

- All changes committed (clean working tree)
- Branch pushed to remote with a merged or mergeable PR

## Steps

1. Run `git status` to verify clean working tree
2. Determine the version:
   - If a version argument is provided (e.g., `v0.1.4`), use it
   - Otherwise, fetch the latest tag with `git tag --sort=-v:refname | head -1` and bump the patch version
3. Check for an open PR on the current branch with `gh pr list --head <branch>`
   - If no PR exists, create one with `gh pr create`
4. Merge the PR with `gh pr merge --merge`
5. Fetch main, tag the merge commit, and push the tag:
   ```
   git fetch origin main
   git tag <version> origin/main
   git push origin <version>
   ```
6. Verify the release workflow started with `gh run list --limit 1`
7. Report the PR URL, tag, and workflow status

## Release Workflow (automated by CI)

Pushing a `v*` tag triggers `.github/workflows/release.yml` which:
- Builds the `tawtui-darwin-arm64` binary via `bun run scripts/compile.ts`
- Generates a SHA-256 checksum
- Creates a GitHub Release with auto-generated notes
- Dispatches a Homebrew tap update to `victorstein/homebrew-tap`

## Version Format

Semver: `v{major}.{minor}.{patch}` (e.g., `v0.1.3`)

- **patch**: Bug fixes, small features
- **minor**: Significant features, new views/modules
- **major**: Breaking changes
