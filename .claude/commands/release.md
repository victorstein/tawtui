---
allowed-tools: Bash(git:*), Bash(gh:*)
argument-hint: ""
---

# /release — How releases work

Releases are **fully automated** via release-please, managed centrally by
`victorstein/stein-infra`. **You do not tag manually.**

## How to cut a release

1. Merge PRs to `main` with **conventional-commit titles** (we squash-merge, so the
   PR title becomes the commit subject):
   - `feat: …` → minor bump
   - `fix: …` → patch bump
   - `feat!: …` or a `BREAKING CHANGE:` footer → major bump
   - `chore:`/`docs:`/`ci:`/`refactor:`/`test:` → no release on their own
2. release-please maintains a long-lived **Release PR** (`chore(main): release X.Y.Z`)
   that accumulates the changelog. The workflow **self-merges** that PR, then **cuts
   the tag + GitHub Release**.
3. That release fires **`.github/workflows/release-publish.yml`**, which builds the
   `tawtui-darwin-arm64` binary + the notify helper, uploads them to the release,
   and dispatches the Homebrew tap update to `victorstein/homebrew-tap`.

There is **no manual `git tag` / `git push <tag>`** — that flow is retired.

## Checking a release

```
gh run list -R victorstein/tawtui --workflow release-please.yml --limit 3
gh run list -R victorstein/tawtui --workflow release-publish.yml --limit 3
gh release list -R victorstein/tawtui
```

## Forcing / fixing a release

- No release after a `feat:`/`fix:` merge? Check the release-please run log for
  "could not be parsed" / "No user facing commits" (a squash-commit-body parser
  snag); open a follow-up PR with a `Release-As: X.Y.Z` footer to force it.
- `release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`,
  and `version.txt` are **tofu-managed by stein-infra** — don't hand-edit them here;
  they're overwritten on the next stein-infra apply.

## Version format

Semver `vMAJOR.MINOR.PATCH` (e.g. `v0.2.13`), driven by the conventional-commit
types above. `version.txt` + `.release-please-manifest.json` are the source of truth.
