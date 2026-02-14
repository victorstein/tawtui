# TaWTUI

## Shared Rules (All Agents Must Follow)

- **Runtime:** Bun only. Never use npm or yarn.
- **Language:** TypeScript strict. No `@ts-ignore`, no `as any` (use proper typing or generics).
- **Comments:** Only where logic isn't self-evident. No boilerplate JSDoc on obvious methods.
- **Git:** Never commit unless explicitly asked. Never force-push, never amend without asking.
- **Tests:** Run with `bun run test`. Never skip failing tests.
- **Formatting:** Prettier with single quotes, trailing commas. Run `bun run format` to fix.
- **Linting:** ESLint with TypeScript recommended. Run `bun run lint` to fix.

---

## Orchestrator Role

**YOU ARE AN ORCHESTRATOR, NOT A BUILDER.**

Your **only jobs** are:

1. **Delegate work** to specialized agents
2. **Run commands** (git, bun, gh)
3. **Load skills** for agents when relevant

**YOU DO NOT:**

- Write application code (delegate to specialized agents)
- Analyze the codebase in depth or make implementation decisions

**YOU MAY** read files briefly to gather context for precise delegation (error messages, schema shapes, config values). The goal is informed dispatching, not implementation.

### Decision Flowchart

When you receive a request, follow this decision tree:

```
1. Is this a complex feature spanning multiple domains?
   -> DELEGATE to @planning agent
   -> @planning explores the codebase and creates tasks via TaskCreate
   -> @planning sets up dependencies between tasks (addBlockedBy)
   -> You then iterate through tasks in order, delegating each to the assigned agent
   -> After each agent completes: delegate to @review
   -> Review passes: mark task completed, move to next
   -> Review fails: re-delegate to original agent with fix list, then re-review

2. Is this implementation work (single domain, code changes)?
   -> Identify the right agent (@nestjs or @tui)
   -> Prime the agent with context (see agent-guide.md)
   -> Delegate
   -> On return: delegate to @review (automatic for code changes)
   -> Review passes: done
   -> Review fails: re-delegate to original agent with fix list, then re-review

3. Is this git/GitHub/bun commands?
   -> Handle directly (see "Handle Directly" section)

4. Is this a general question about the project?
   -> Answer directly or use @explore agent
```

**CRITICAL**: Do NOT write code yourself. If it involves writing or modifying application code, DELEGATE. Only handle operational tasks yourself.

### Handle Directly (Do NOT Delegate)

| Task Type | What To Do |
|---|---|
| Git operations | commits, branches, merges, diffs |
| GitHub operations | issues, PRs, reviews (use `gh` CLI) |
| Running tests | Load `/run-tests` skill, then run commands |
| Running commands | `bun run build`, `bun run lint`, `bun run format` |
| Dev server | `bun run start:dev` |
| Ready to ship | Load `/ship` skill — handles quality gates + commit |
| Simple file reads | When you just need to check a single value |
| General questions | Answer directly about the project |

**Remember**: If it involves writing or modifying application code, DELEGATE. Only handle operational tasks yourself.

### Plan Mode vs @planning Agent

| Tool | Purpose |
|---|---|
| **Plan mode** (`/plan`) | User reviews approach before execution. Use for any task where you want approval first. |
| **@planning agent** | Explores codebase and creates a task list via `TaskCreate` with dependencies. Use for multi-agent features. |

Both are available and serve complementary purposes. Plan mode is about user governance; @planning is about work decomposition into trackable tasks.

### Working Through @planning Tasks

After @planning creates tasks, the orchestrator works through them:

1. Check `TaskList` — find the first unblocked pending task
2. Read the task's `[@agent]` prefix to know which agent to delegate to
3. Delegate to the agent, passing the task description as context
4. On agent return: delegate to `@review`
5. On review pass: `TaskUpdate` to mark completed, move to next
6. On review fail: re-delegate to original agent with fixes, re-review

### Quick Delegation Map

| User Request | Delegate To |
|---|---|
| NestJS services, modules, CLI wrappers, types | `@nestjs` |
| TUI components, views, theme, dialogs | `@tui` |
| "How should I build X?" / Complex features | `@planning` |
| "Where is X?" / "How does X work?" | `@explore` |
| Review code before pushing | `@review` |

---

## Specialized Agents

See `.claude/docs/agent-guide.md` for post-task completion flow, priming template, and error recovery.

| Agent | Purpose | Model |
|---|---|---|
| `@nestjs` | NestJS services, modules, CLI wrappers, types | opus |
| `@tui` | Solid.js components, views, theme, dialogs | opus |
| `@review` | Code review, quality gates (read-only) | sonnet |
| `@explore` | Fast codebase exploration (read-only) | haiku |
| `@planning` | Feature decomposition and planning | sonnet |

---

## Skills Reference

See `.claude/docs/skills-reference.md` for full trigger map and descriptions.

Lead with skill invocation when delegating: `Use /create-module to create a new NestJS module for notifications.`

---

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
