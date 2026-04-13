# Oracle Module

## Architecture

The Oracle uses a **decoupled event-driven architecture** with three layers:

```
NestJS (ingestion) → HTTP POST → Channel Server (MCP bridge) → Claude Code (agent)
```

## oracle-channel.ts — Standalone MCP Server

**This is NOT a NestJS service.** It is a standalone Bun script with a shebang (`#!/usr/bin/env bun`) that Claude Code spawns as a subprocess MCP server. Do NOT import it into the NestJS module system.

- Runs an HTTP server on `localhost:7851` (hardcoded, no fallback)
- Accepts JSON POST payloads, converts them to MCP notifications via `mcp.notification()`
- Embeds system instructions (42 lines) telling Claude how to handle events
- Registered in `.mcp.json` at the Oracle workspace directory

## OracleEventService — NestJS-Side Integration

**Manually instantiated** (not NestJS DI) — dynamically imported and constructed in `tui.service.ts` to avoid circular deps:

```typescript
const { OracleEventService } = await import('./oracle/oracle-event.service');
const oracleEventService = new OracleEventService(ORACLE_WORKSPACE_DIR);
```

Key behaviors:
- `postEvent()` is **fire-and-forget** (`void` — not awaited). Errors are logged, never thrown.
- Retries 3 times with 2s exponential backoff if channel server is slow to start.
- `readRejectedTasks(sinceDate)` reads `rejected/YYYY-MM-DD.md` files from the workspace (default 7-day window).

## Event Types

| Event | Trigger | Key Fields |
|---|---|---|
| `sync-complete` | After ingestion finds new messages | `messagesStored`, `channels[]`, `rejectedTasks` |
| `daily-digest` | First TUI launch after 12+ hours | `rejectedTasks` |

Both events include `rejectedTasks` — the full concatenated text of rejected task files, so Claude can avoid re-proposing rejected items.

## Oracle Workspace (`~/.local/share/tawtui/oracle-workspace`)

Contents:
- `.mcp.json` — MCP server config (created idempotently by `tui.service.ts`)
- `rejected/` — Claude writes rejected tasks here (YYYY-MM-DD.md, one line per rejection)
- Oracle state and mempalace plugin files

## Oracle Session (tmux)

- Created by `terminal.service.ts:createOracleSession()`
- **Singleton** — only one running Oracle session allowed at a time
- Tagged with `isOracleSession = true` for identification
- Uses `--dangerously-load-development-channels server:oracle-channel` to subscribe to channel events
- Prompt is **baked into code** (not configurable) — changes require restart

## Gotchas

- **Port 7851 is hardcoded** — no dynamic port selection. If occupied, channel server fails silently.
- **"Daily digest" fires on launch, not daily** — triggers on first TUI start after 12+ hours since `lastDigestAt`.
- **Rejected tasks are append-only text** — no structured format. Claude does string matching against the payload.
- **No auto-restart** — if the Oracle session dies, user must re-launch via UI.
- **Prompt changes need session restart** — the entire prompt is a CLI argument, not a hot-reloadable config.
