# Oracle Channel Events Design

> Replace the polling-based `/loop` oracle with an event-driven architecture using Claude Code Channels. The oracle agent reacts to sync-complete and daily-digest events pushed into its session, instead of blindly searching mempalace every 5 minutes.

## Overview

The current oracle runs a Claude Code session with a `/loop 5m` that repeatedly searches mempalace for commitments. This is stateless (re-proposes rejected items), wasteful (searches when nothing changed), and noisy (runs whether or not data arrived).

This redesign introduces a one-way Claude Code Channel MCP server that pushes events into the oracle session when something actually happens. Two event types drive the agent:

- **sync-complete**: fired by the ingestion service after new Slack messages are mined into mempalace
- **daily-digest**: fired on first TUI launch of the day (>12h since last digest)

The oracle agent sits idle until an event arrives, then searches mempalace, proposes tasks if it finds commitments, and goes quiet again.

## Channel Server

### File

`src/modules/oracle/oracle-channel.ts` — a standalone Bun script (~50 lines).

### Responsibilities

- Create an MCP `Server` with `claude/channel` capability
- Connect over stdio (Claude Code spawns it as a subprocess)
- Listen on `127.0.0.1:7851` for HTTP POSTs
- Forward each POST body as a `notifications/claude/channel` event
- Set `meta.event_type` to the payload's `type` field (`"sync-complete"` or `"daily-digest"`)

### Contract

One-way only. No reply tool, no `capabilities.tools`. The `instructions` field in the Server constructor tells the oracle agent what events to expect and how to handle each type.

### MCP Notification Format

```typescript
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: JSON.stringify(payload),  // full event payload as JSON string
    meta: { event_type: payload.type },
  },
})
```

The agent receives:

```
<channel source="oracle-channel" event_type="sync-complete">
{"type":"sync-complete","messagesStored":47,"channels":["#backend","#deploys"],"rejectedTasks":"..."}
</channel>
```

### Port

Hardcoded constant `ORACLE_CHANNEL_PORT = 7851`. Localhost-only binding.

## Event Producers

### sync-complete

**Trigger:** `SlackIngestionService.safeIngest()`, after a successful ingest with `messagesStored > 0`.

**Payload:**

```typescript
{
  type: 'sync-complete',
  messagesStored: number,
  channels: string[],        // Slack channel display names (e.g. "#backend", "#deploys") that had new messages
  rejectedTasks: string,     // contents of rejected/ files (see Rejected Task Tracking)
}
```

**Behavior:**
- Reads rejected task files from `ORACLE_WORKSPACE_DIR/rejected/` (scoped by date window, see below)
- POSTs to `http://127.0.0.1:7851`
- Fire-and-forget — errors are logged but don't break ingestion
- Only fires when `messagesStored > 0` (no event for empty syncs)

### daily-digest

**Trigger:** TUI boot sequence in `tui.service.ts`, after oracle session auto-launch.

**Payload:**

```typescript
{
  type: 'daily-digest',
  rejectedTasks: string,
}
```

**Behavior:**
- Checks `lastDigestAt` in oracle config
- If >12h since last digest (or never run): POSTs to `http://127.0.0.1:7851`
- Updates `lastDigestAt` in oracle config after posting
- Fire-and-forget

**Timing:** The POST must wait for the channel server to be ready. After `createOracleSession()` returns, the Claude Code process is starting but the channel server inside it may not be listening yet. The producer retries the POST with a short backoff (e.g. 3 attempts, 2s apart) to handle this startup race. Once the channel server binds port 7851, the POST lands.

### Rejected Task Inclusion

Both producers read files from `ORACLE_WORKSPACE_DIR/rejected/` and include the contents in the payload. The date window starts at `lastDigestAt` (or 7 days ago if unset) through today. This ensures the agent always has the rejected list in-context without relying on it to remember to read the file.

## Oracle Session Auto-Launch

### Trigger

On TUI boot in `tui.service.ts`, after dependency check resolves with `oracleReady === true`.

### Behavior

- Call `createOracleSession()` — which already handles "if existing session, reuse it" via the `isOracleSession` flag and session persistence
- Happens regardless of which tab the user is on
- No toast on auto-launch — the session starts silently in the background

### Command Modification

`createOracleSession()` in `terminal.service.ts` adds `--dangerously-load-development-channels server:oracle-channel` to the Claude Code command, alongside the existing `autoApproveFlag`. This activates the channel server from `.mcp.json` in the oracle workspace.

### Dependency Gating

Auto-launch only works after `initializeOracle()` has completed (which includes channel server installation). The existing `oracleReady` check gates on `oracleInitialized`, so no new dependency flags are needed.

## Channel Server Installation

### Where in the Flow

Added as a new substep in `initializeOracle()` in `tui.service.ts`, after the mempalace plugin install (current final step).

### What It Does

1. Reads existing `.mcp.json` in `ORACLE_WORKSPACE_DIR` (created by `claude plugin install --scope project` for mempalace)
2. Merges the `oracle-channel` entry into `mcpServers`:

```json
{
  "mcpServers": {
    "mempalace": { "...existing..." },
    "oracle-channel": {
      "command": "bun",
      "args": ["/absolute/path/to/oracle-channel.ts"]
    }
  }
}
```

3. Resolves the absolute path to `oracle-channel.ts` at runtime (the file ships with tawtui in `src/modules/oracle/`; the install step resolves this to an absolute path for `.mcp.json`)
4. Writes back without clobbering the mempalace entry
5. Reports progress: "Installing Oracle channel..." → "Oracle channel installed"

### Scoping

The `.mcp.json` lives in `ORACLE_WORKSPACE_DIR` (`~/.local/share/tawtui/oracle-workspace`). Since the oracle session's `cwd` is set to this directory, the channel server is only available to the oracle session — not the user's regular Claude Code sessions.

## Oracle Prompt Rewrite

### Removed

- `/loop 5m` instruction
- "On each run" proactive search workflow
- Generic mempalace search query suggestions

### Kept (unchanged)

- Task creation syntax (full Taskwarrior CLI reference)
- Commitment detection rules (explicit commitments only, examples of what IS and IS NOT a commitment)
- Source prioritization (DMs over channels, verify messages are FROM the user)
- "Never create tasks without confirmation" approval gate

### New: Event Handling

The prompt teaches the agent to react to `<channel source="oracle-channel">` events:

**sync-complete:**
- Parse the JSON payload for `channels` and `messagesStored`
- Search mempalace for conversations from the reported channels
- Cross-check against `rejectedTasks` in the payload AND `task list +oracle` for duplicates
- If new commitments found: propose them with the standard format (Task / Source / Command)
- If nothing new: stay silent — no "nothing found" output

**daily-digest:**
- Broader search across all recent conversations in mempalace
- Summarize key threads, unresolved discussions, and surface any commitments
- More narrative, less task-creation focused
- Still propose tasks for explicit commitments found

### New: Rejected Task Management

The prompt instructs the agent to:
- Read the `rejectedTasks` field from every channel event payload
- After the user rejects a proposed task, append a line to `rejected/YYYY-MM-DD.md` (today's date) with the original quote so it can be matched against future results
- Never re-propose items that appear in the rejected list

### New: Alert Marker

When the agent finds actionable items, it starts its response with `[ORACLE ALERT]`. The TUI uses this marker to trigger toast notifications when the user is on a different tab.

## Toast Notifications

### Detection

In `app.tsx` (which is always mounted regardless of active tab), watch the oracle session's captured terminal output for the `[ORACLE ALERT]` marker.

### Mechanism

- Use the existing `useToast()` system
- Only fire when the oracle tab is not currently active
- Toast content: "Oracle found new action items" (info type)

### Deduplication

Track the last alerted capture content (e.g. line count or hash) to avoid re-toasting the same alert on repeated poll ticks.

## Rejected Task Tracking

### Structure

```
ORACLE_WORKSPACE_DIR/
  rejected/
    2026-04-11.md
    2026-04-12.md
    ...
```

One file per day. Each file contains one rejection per line with the original quote from the conversation, so it can be matched against future mempalace search results.

### Date Window

When constructing event payloads, tawtui reads files from `rejected/` starting from `lastDigestAt` date (or 7 days ago if unset) through today. Files outside this window are ignored.

### Agent Writes

The prompt instructs the agent to append to `rejected/YYYY-MM-DD.md` (today's date) when the user rejects a proposed task.

### Payload Inclusion

Both event types include `rejectedTasks` in the payload — the concatenated contents of all files in the date window. This ensures the agent sees the rejected list even if it forgets to read the file.

## Config & State Changes

### OracleConfig additions

```typescript
interface OracleConfig {
  slack?: SlackCredentials;
  pollIntervalSeconds: number;
  defaultProject?: string;
  lastDigestAt?: string;  // NEW — ISO timestamp of last daily digest
}
```

### New constant

```typescript
export const ORACLE_CHANNEL_PORT = 7851;
```

Exported from a shared location alongside `ORACLE_WORKSPACE_DIR`.

### Dependency check

`oracleReady` conditions are unchanged. The channel server install is part of `initializeOracle()`, which already gates `oracleInitialized`.

## What Does NOT Change

- The 3-step setup screen UI (step 3 gets a new substep internally, but no user-facing change)
- Session persistence and reuse logic
- Mempalace as the search backend
- The `isOracleSession` flag and session detection
- Slack ingestion polling interval
- Taskwarrior integration
