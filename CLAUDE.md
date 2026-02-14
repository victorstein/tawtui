# TaWTUI — Orchestrator Guide

## Shared Rules

- **Runtime:** Bun only. Never use npm or yarn.
- **Language:** TypeScript strict. No `@ts-ignore`, no `as any` (use proper typing or generics).
- **Comments:** Only where logic isn't self-evident. No boilerplate JSDoc on obvious methods.
- **Git:** Never commit unless explicitly asked. Never force-push, never amend without asking.
- **Tests:** Run with `bun run test`. Never skip failing tests.
- **Formatting:** Prettier with single quotes, trailing commas. Run `bun run format` to fix.
- **Linting:** ESLint with TypeScript recommended. Run `bun run lint` to fix.

## Orchestrator Role

You are the orchestrator. Your job is to delegate to specialized agents and handle infrastructure tasks directly.

### Decision Flowchart

1. Is it a git/GitHub/bun command? → **Handle directly**
2. Is it about NestJS services, modules, or types? → **Delegate to `@nestjs`**
3. Is it about TUI components, views, or theme? → **Delegate to `@tui`**
4. Is it a code review request? → **Delegate to `@review`**
5. Is it a quick codebase question? → **Delegate to `@explore`**
6. Is it a complex multi-step feature? → **Delegate to `@planning`** first, then to implementation agents

### Handle Directly

- Git operations (`git status`, `git diff`, `git log`, commit, push, branch)
- GitHub CLI (`gh pr`, `gh issue`, `gh repo`)
- Running tests (`bun run test`)
- Running dev server (`bun run start:dev`)
- Bun commands (`bun install`, `bun add`, `bun remove`)
- Simple file reads and quick searches

## Quick Delegation Map

| Request Type | Agent | Example |
|---|---|---|
| New NestJS module/service | `@nestjs` | "Add a notifications module" |
| Modify existing service | `@nestjs` | "Add a method to TaskwarriorService" |
| New TUI component | `@tui` | "Add a progress bar component" |
| Modify view/component | `@tui` | "Add keyboard shortcut to tasks view" |
| Theme changes | `@tui` | "Add a new color token" |
| Code review | `@review` | "Review my changes before shipping" |
| "Where is X?" questions | `@explore` | "Where is the config stored?" |
| Complex feature planning | `@planning` | "Plan the notifications feature" |

## Specialized Agents

| Agent | Purpose | Model |
|---|---|---|
| `@nestjs` | NestJS services, modules, CLI wrappers, types | opus |
| `@tui` | Solid.js components, views, theme, dialogs | opus |
| `@review` | Code review, quality gates (read-only) | sonnet |
| `@explore` | Fast codebase exploration (read-only) | haiku |
| `@planning` | Feature decomposition and planning | sonnet |

## Skills Reference

| Trigger | Skill |
|---|---|
| Creating a new NestJS module | `create-module` |
| Creating a new TUI component | `create-component` |
| Running tests | `run-tests` |

## Project Structure

```
tawtui/
├── src/
│   ├── main.ts                          # Entry point (CommandFactory bootstrap)
│   ├── app.module.ts                    # Root NestJS module
│   ├── commands/
│   │   └── tui.command.ts               # Default command → launches TUI
│   ├── shared/
│   │   └── types.ts                     # Shared types (RepoConfig, ExecResult)
│   └── modules/
│       ├── taskwarrior.module.ts         # ← @nestjs
│       ├── taskwarrior.service.ts        # ← @nestjs (wraps `task` CLI)
│       ├── taskwarrior.types.ts          # ← @nestjs
│       ├── github.module.ts             # ← @nestjs
│       ├── github.service.ts            # ← @nestjs (wraps `gh` CLI)
│       ├── github.types.ts              # ← @nestjs
│       ├── config.module.ts             # ← @nestjs
│       ├── config.service.ts            # ← @nestjs (~/.config/tawtui/)
│       ├── config.types.ts              # ← @nestjs
│       ├── terminal.module.ts           # ← @nestjs
│       ├── terminal.service.ts          # ← @nestjs (wraps `tmux`)
│       ├── terminal.types.ts            # ← @nestjs
│       ├── tui.module.ts               # Bridge module (imports service modules)
│       ├── tui.service.ts              # Bridge service (globalThis.__tawtui)
│       └── tui/                         # ← @tui (all files below)
│           ├── app.tsx                  # Root app component
│           ├── theme.ts                 # Color palette + semantic tokens
│           ├── context/
│           │   └── dialog.tsx           # Stack-based dialog context
│           ├── components/
│           │   ├── board-column.tsx
│           │   ├── task-card.tsx
│           │   ├── task-form.tsx
│           │   ├── tab-bar.tsx
│           │   ├── status-bar.tsx
│           │   ├── filter-bar.tsx
│           │   ├── archive-view.tsx
│           │   ├── dialog-confirm.tsx
│           │   ├── dialog-prompt.tsx
│           │   ├── dialog-select.tsx
│           │   ├── repo-list.tsx
│           │   ├── pr-list.tsx
│           │   ├── agent-list.tsx
│           │   └── terminal-output.tsx
│           └── views/
│               ├── tasks-view.tsx
│               ├── repos-view.tsx
│               └── agents-view.tsx
├── test/                                # Jest test files
├── package.json                         # Bun scripts (start, build, test, lint, format)
├── tsconfig.json                        # TS config (ESNext, SolidJS JSX)
└── eslint.config.mjs                    # ESLint flat config
```
