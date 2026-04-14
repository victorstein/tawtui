# Specialized Agents

## @nestjs

- **Purpose**: NestJS services, modules, CLI wrappers, types, dependency injection
- **Codebase**: `src/modules/*.module.ts`, `src/modules/*.service.ts`, `src/modules/*.types.ts`, `src/commands/`, `src/main.ts`, `src/app.module.ts`, `src/shared/`
- **Use for**: New modules, services, CLI wrappers, types, DI configuration
- **Model**: Opus
- **Oracle/Slack modules**:
  - `src/modules/oracle/` — Oracle event service and channel types. Note: `oracle-channel.ts` is a standalone MCP server script, not a regular NestJS module — see note below.
  - `src/modules/slack/` — Slack API wrapper, ingestion service, mempalace integration
  - `src/modules/notification.service.ts` — macOS notification helper

> **Oracle channel special case**: `src/modules/oracle/oracle-channel.ts` is NOT a regular NestJS service. It is a standalone Bun script that Claude Code spawns as a subprocess MCP server. It must not be imported into the NestJS module system. The `OracleEventService` is the NestJS-side integration point for Oracle events.

## @tui

- **Purpose**: Solid.js TUI components, views, theme, dialog context
- **Codebase**: `src/modules/tui/`
- **Use for**: Components, views, theme tokens, dialogs, keyboard handling
- **Model**: Opus
- **Design Reference**: `.claude/docs/tui-design-reference.md` — semantic tokens, gradient patterns, button styles, border conventions, powerline caps, selection/focus patterns. **Must read before building any new component.**
- **Oracle UI**:
  - `src/modules/tui/views/oracle-view.tsx` — Oracle tab view
  - `src/modules/tui/components/oracle-setup-screen.tsx` — Setup wizard

## @planning

- **Purpose**: Explore codebase and create structured task lists via `TaskCreate`
- **Use for**: Features spanning both @nestjs and @tui, multi-step work
- **Output**: Tasks with `[@agent]` prefixes and dependencies (addBlockedBy)
- **Model**: Sonnet

## @explore

- **Purpose**: Fast codebase exploration (read-only)
- **Use for**: Finding files, understanding architecture, answering "where/how" questions
- **Model**: Haiku

## @review

- **Purpose**: Code quality review (read-only)
- **Use for**: Pre-push review, checking types/lint/format/build/tests
- **Model**: Sonnet

---

## Agent Priming

When delegating work, prime the agent with structured context:

```
Use /relevant-skill for: <task description>

Context: <what the user asked for>
Files: <relevant files if known>
Constraints: <any specific requirements>
```

### Field Guide

| Field | Include When |
|---|---|
| Skill | Always (triggers skill loading for new modules/components) |
| Context | Always (what the user wants) |
| Files | When you know which files are affected |
| Constraints | When there are specific requirements or dependencies |

### When to Skip Priming

- **Exploration**: Questions routed to `@explore`
- **Re-delegation**: Agent already has context from a previous attempt (just send fix instructions)
- **Trivial fixes**: Single-line changes where the instruction is self-contained

---

## Post-Task Completion Flow

When an agent completes a task that involves **code changes**:

1. **Agent returns** with completion status
2. **Delegate to `@review`** to verify quality gates
3. **Based on review result**:
   - **Passes**: Report success to user
   - **Needs fixes**: Re-delegate to original agent with the fix list, then re-review
   - **Major rework**: Re-delegate to `@planning` to decompose further

**Skip code review for:**

- Documentation-only changes
- Config file updates
- Non-code tasks (e.g., "research X", "create plan")

---

## Error Recovery

When an agent returns with errors or incomplete work:

| Situation | Action |
|---|---|
| Type/lint errors | Re-delegate to same agent with error output |
| Test failures | Re-delegate with test output + failing test path |
| Unclear requirements | Ask user for clarification, then re-delegate |
| Agent stuck/looping | Summarize context and escalate to user |
| Agent reports discovered work | Note it and ask user if they want to address it |

Never retry the same failing approach more than once. If re-delegation fails, escalate to user.

---

## Testing Expectations

When an agent implements or modifies a service, adversarial integration tests should accompany the change if the service has an existing integration test file.

### Integration test files by domain

| Domain | Integration Test File |
|---|---|
| Slack (ingestion, API, mempalace) | `test/slack/slack-integration.spec.ts` |
| Terminal (tmux sessions) | `test/terminal/terminal-integration.spec.ts` |
| Taskwarrior (task CLI) | `test/taskwarrior/taskwarrior-integration.spec.ts` |
| Config (file persistence) | `test/config/config-integration.spec.ts` |
| GitHub (gh CLI) | `test/github/github-integration.spec.ts` |
| Worktree (git worktrees) | `test/worktree/worktree-integration.spec.ts` |

### When to add integration tests

- Adding a new public method to an existing service → add adversarial scenarios
- Fixing a bug → add a test that reproduces the bug first
- Changing error handling or state management → add boundary corruption or failure cascade tests

### Test helpers available

See `test/CLAUDE.md` for the full list. Key ones:
- `TaskwarriorTestHelper.routedSpawnSync()` — mock Bun.spawnSync with per-command routing
- `WorktreeTestHelper.routedSpawn()` — mock async Bun.spawn with per-command routing and delays
- `IntegrationHelper.createSlackStack()` — full Slack service stack with temp dirs

---

## Delegation Examples

### New NestJS module

```
Delegate to @nestjs:
Use /create-module to create a new NestJS module for notifications.

Context: User wants push notifications when tasks are overdue.
Constraints: Must follow the Module Triad pattern. Register in app.module.ts.
If TUI needs access, also register in tui.service.ts global bridge.
```

### New TUI component

```
Delegate to @tui:
Use /create-component to create a notification-badge component.

Context: Shows unread notification count in the tab bar.
Files: src/modules/tui/components/tab-bar.tsx (will need to import the new component)
Constraints: Use theme tokens only. Access notification service via globalThis.__tawtui.
```

### Complex feature (via @planning)

```
Delegate to @planning:
Plan the notifications feature.

Context: User wants task overdue notifications with a badge in the TUI.
This spans both @nestjs (notification service) and @tui (badge component, view).
Create tasks via TaskCreate with [@agent] prefixes and set up dependencies.
```

@planning will create tasks like:
1. `[@nestjs] Create notification types` — no deps
2. `[@nestjs] Create notification service and module` — blocked by #1
3. `[@tui] Create notification-badge component` — blocked by #2
4. `[@review] Review notification feature` — blocked by #3

The orchestrator then iterates through the task list, delegating each to the assigned agent.

### Code review after implementation

```
Delegate to @review:
Review the changes made by @tui for the notification badge component.

Changed files: src/modules/tui/components/notification-badge.tsx, src/modules/tui/components/tab-bar.tsx
```

---

## Working Through @planning Tasks

After @planning creates and returns, the orchestrator follows this loop:

1. `TaskList` — find first unblocked pending task
2. Read the `[@agent]` prefix from the subject
3. `TaskUpdate` — mark as `in_progress`
4. Delegate to the agent, passing the task description as the prompt
5. On agent return: delegate to `@review` (unless the task IS a review task)
6. On review pass: `TaskUpdate` — mark as `completed`, go to step 1
7. On review fail: re-delegate to original agent with fix list, re-review, then step 6

Stop when all tasks are completed. Report the summary to the user.
