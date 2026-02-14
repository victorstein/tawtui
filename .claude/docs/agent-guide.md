# Specialized Agents

## @nestjs

- **Purpose**: NestJS services, modules, CLI wrappers, types, dependency injection
- **Codebase**: `src/modules/*.module.ts`, `src/modules/*.service.ts`, `src/modules/*.types.ts`, `src/commands/`, `src/main.ts`, `src/app.module.ts`, `src/shared/`
- **Use for**: New modules, services, CLI wrappers, types, DI configuration
- **Model**: Opus

## @tui

- **Purpose**: Solid.js TUI components, views, theme, dialog context
- **Codebase**: `src/modules/tui/`
- **Use for**: Components, views, theme tokens, dialogs, keyboard handling
- **Model**: Opus
- **Design Reference**: `.claude/docs/tui-design-reference.md` — semantic tokens, gradient patterns, button styles, border conventions, powerline caps, selection/focus patterns. **Must read before building any new component.**

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
