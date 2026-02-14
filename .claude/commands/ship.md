---
allowed-tools: Bash(bun:*), Bash(git:*), Read, Glob, Grep
argument-hint: "[commit-message]"
---

# /ship — Quality Gates + Commit

Run all quality gates, then stage and commit if everything passes.

## Steps

1. Run `git status` to see what changed
2. Run quality gates **sequentially** — stop on first failure:
   - `bun run lint`
   - `bun run format`
   - `bun run build`
   - `bun run test`
3. If all gates pass:
   - Stage changed files with `git add` (specific files, not `-A`)
   - Commit with the provided message or a generated conventional commit message
   - Format: `type(scope): description` (e.g., `feat(tui): add progress bar component`)
4. Report results

## On Failure

- **Stop immediately** when any gate fails
- Report which check failed and the error output
- Suggest a fix if possible
- **Do NOT auto-fix** — let the user or appropriate agent handle it

## Commit Message Format

If a commit message argument is provided, use it. Otherwise generate one:

- `feat(scope):` — New feature
- `fix(scope):` — Bug fix
- `refactor(scope):` — Code restructuring
- `style(scope):` — Formatting, theme changes
- `test(scope):` — Test additions/changes
- `chore(scope):` — Build, config, dependencies

Scopes: `tui`, `taskwarrior`, `github`, `config`, `terminal`, `core`
