# Skills Reference

## Skill Trigger Map

| Task | Skill | Delegate To |
|---|---|---|
| Create NestJS module | `/create-module` | `@nestjs` |
| Create TUI component | `/create-component` | `@tui` |

## Standalone Skills (No Delegation)

| Skill | When to Use |
|---|---|
| `/run-tests` | Before running tests |
| `/ship` | Ready to commit — runs quality gates and commits |
| `/dev` | Start dev server with hot reload |

## How Skills Work

Skills are specialized prompts that provide patterns and conventions. The orchestrator leads with skill invocation when delegating:

```
Use /create-module to create a new NestJS module for notifications.
```

The skill gets loaded into the agent's context, giving it the template and conventions to follow.

## Skill Descriptions

### /create-module

Creates a new NestJS module following the Module Triad pattern (`.types.ts`, `.service.ts`, `.module.ts`). Includes registration in `app.module.ts` and optional global bridge registration in `tui.service.ts`.

### /create-component

Creates a new Solid.js TUI component with proper props interface, theme token usage, and service access via the global bridge. Follows kebab-case file naming and PascalCase exports.

### /run-tests

Provides test commands and conventions. Test framework is Jest 30 with ts-jest and @nestjs/testing. Tests are co-located (`src/**/*.spec.ts`) or in `test/**/*.e2e-spec.ts`.

### /ship

Runs quality gates sequentially (lint, format, build, test), stages files, and commits with conventional commit format. Scopes: tui, taskwarrior, github, config, terminal, core.

### /dev

Starts the dev server with `bun run start:dev` (hot reload via `bun run --watch`).
