# Oracle Channel Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the polling-based `/loop` oracle with an event-driven architecture using Claude Code Channels, so the oracle agent reacts to sync-complete and daily-digest events instead of blindly searching mempalace every 5 minutes.

**Architecture:** A one-way Channel MCP server (`oracle-channel.ts`) listens on localhost:7851. The ingestion service POSTs sync-complete events after new messages arrive; the TUI boot sequence POSTs daily-digest events on first launch of the day. The oracle prompt is rewritten to react to `<channel>` tags instead of looping.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP), Bun HTTP server, existing NestJS services, SolidJS TUI components.

**Spec:** `docs/superpowers/specs/2026-04-11-oracle-channel-events-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/modules/oracle/oracle-channel.ts` | Standalone MCP channel server (Bun script) |
| Create | `src/modules/oracle/oracle-channel.types.ts` | Event payload types and shared constants |
| Create | `src/modules/oracle/oracle-event.service.ts` | NestJS service: reads rejected/, builds payloads, POSTs to channel |
| Create | `test/oracle-event.service.spec.ts` | Tests for event service |
| Create | `test/oracle-channel.spec.ts` | Tests for channel server HTTP handling |
| Modify | `src/modules/config.types.ts:33-40` | Add `lastDigestAt` to `OracleConfig` |
| — | `src/modules/slack/mempalace.service.ts` | Unchanged — `ORACLE_WORKSPACE_DIR` still exported from here |
| Modify | `src/modules/tui.service.ts:256-262` | Add channel install step to `initializeOracle()` |
| Modify | `src/modules/tui.service.ts:280-288` | Add auto-launch + daily-digest trigger on boot |
| Modify | `src/modules/terminal.service.ts:835-921` | Rewrite oracle prompt + add channel flag to command |
| Modify | `src/modules/slack/slack-ingestion.service.ts:471-480` | Fire sync-complete event in `safeIngest()` |
| Modify | `src/modules/tui/app.tsx:52-61` | Add oracle alert toast detection |
| Modify | `src/modules/tui.service.ts:1-10` | Import new oracle module |
| Modify | `src/modules/slack/slack-ingestion.service.ts:56` | Extend ingest() return to include channel names |

---

### Task 1: Types and Constants

**Files:**
- Create: `src/modules/oracle/oracle-channel.types.ts`
- Modify: `src/modules/config.types.ts:33-40`

- [ ] **Step 1: Create oracle channel types file**

```typescript
// src/modules/oracle/oracle-channel.types.ts

/** Port the oracle channel MCP server listens on (localhost only). */
export const ORACLE_CHANNEL_PORT = 7851;

/** Payload for sync-complete events — fired after ingestion finds new messages. */
export interface SyncCompleteEvent {
  type: 'sync-complete';
  messagesStored: number;
  channels: string[];
  rejectedTasks: string;
}

/** Payload for daily-digest events — fired on first TUI launch of the day. */
export interface DailyDigestEvent {
  type: 'daily-digest';
  rejectedTasks: string;
}

/** Union of all oracle channel event payloads. */
export type OracleChannelEvent = SyncCompleteEvent | DailyDigestEvent;
```

- [ ] **Step 2: Add `lastDigestAt` to OracleConfig**

In `src/modules/config.types.ts`, add the field to `OracleConfig`:

```typescript
export interface OracleConfig {
  /** Slack session credentials — set via setup wizard */
  slack?: SlackCredentials;
  /** How often the daemon polls Slack in seconds (default: 300 = 5 min) */
  pollIntervalSeconds: number;
  /** Taskwarrior project to assign Oracle-created tasks */
  defaultProject?: string;
  /** ISO timestamp of the last daily digest event (used to gate >12h check) */
  lastDigestAt?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/oracle/oracle-channel.types.ts src/modules/config.types.ts
git commit -m "feat(oracle): add channel event types and lastDigestAt config field"
```

---

### Task 2: Oracle Event Service — Rejected Task Reader

**Files:**
- Create: `src/modules/oracle/oracle-event.service.ts`
- Create: `test/oracle-event.service.spec.ts`

- [ ] **Step 1: Write the failing test for `readRejectedTasks`**

```typescript
// test/oracle-event.service.spec.ts
import { OracleEventService } from '../src/modules/oracle/oracle-event.service';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('OracleEventService', () => {
  let service: OracleEventService;
  let tmpDir: string;
  let rejectedDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oracle-event-test-'));
    rejectedDir = join(tmpDir, 'rejected');
    mkdirSync(rejectedDir, { recursive: true });
    service = new OracleEventService(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe('readRejectedTasks', () => {
    it('returns empty string when rejected/ does not exist', () => {
      rmSync(rejectedDir, { recursive: true });
      expect(service.readRejectedTasks()).toBe('');
    });

    it('returns empty string when rejected/ is empty', () => {
      expect(service.readRejectedTasks()).toBe('');
    });

    it('reads files within the date window', () => {
      writeFileSync(join(rejectedDir, '2026-04-10.md'), 'rejected task A\n');
      writeFileSync(join(rejectedDir, '2026-04-11.md'), 'rejected task B\n');
      // Set window: last 7 days from 2026-04-11
      const result = service.readRejectedTasks(new Date('2026-04-04'));
      expect(result).toContain('rejected task A');
      expect(result).toContain('rejected task B');
    });

    it('excludes files outside the date window', () => {
      writeFileSync(join(rejectedDir, '2026-03-01.md'), 'old rejection\n');
      writeFileSync(join(rejectedDir, '2026-04-11.md'), 'recent rejection\n');
      const result = service.readRejectedTasks(new Date('2026-04-10'));
      expect(result).not.toContain('old rejection');
      expect(result).toContain('recent rejection');
    });

    it('defaults to 7 days ago when no sinceDate provided', () => {
      // A file from today should always be included
      const today = new Date().toISOString().split('T')[0];
      writeFileSync(join(rejectedDir, `${today}.md`), 'today rejection\n');
      expect(service.readRejectedTasks()).toContain('today rejection');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --testPathPattern oracle-event`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `OracleEventService` with `readRejectedTasks`**

```typescript
// src/modules/oracle/oracle-event.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ORACLE_CHANNEL_PORT } from './oracle-channel.types';
import type { OracleChannelEvent } from './oracle-channel.types';

@Injectable()
export class OracleEventService {
  private readonly logger = new Logger(OracleEventService.name);
  private readonly rejectedDir: string;

  constructor(private readonly workspaceDir: string) {
    this.rejectedDir = join(workspaceDir, 'rejected');
  }

  /**
   * Read rejected task files from the rejected/ directory within a date window.
   * Returns concatenated contents of all files from sinceDate through today.
   */
  readRejectedTasks(sinceDate?: Date): string {
    if (!existsSync(this.rejectedDir)) return '';

    const since = sinceDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().split('T')[0];

    const files = readdirSync(this.rejectedDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => f.slice(0, 10) >= sinceStr)
      .sort();

    if (files.length === 0) return '';

    return files
      .map((f) => readFileSync(join(this.rejectedDir, f), 'utf-8'))
      .join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --testPathPattern oracle-event`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/oracle/oracle-event.service.ts test/oracle-event.service.spec.ts
git commit -m "feat(oracle): add OracleEventService with rejected task reader"
```

---

### Task 3: Oracle Event Service — POST to Channel

**Files:**
- Modify: `src/modules/oracle/oracle-event.service.ts`
- Modify: `test/oracle-event.service.spec.ts`

- [ ] **Step 1: Write the failing test for `postEvent`**

Add to `test/oracle-event.service.spec.ts`:

```typescript
  describe('postEvent', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 }),
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('POSTs event payload to the channel server', async () => {
      await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:7851',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ type: 'daily-digest', rejectedTasks: '' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('retries on connection refused (up to 3 attempts)', async () => {
      const connErr = new TypeError('fetch failed');
      fetchSpy
        .mockRejectedValueOnce(connErr)
        .mockRejectedValueOnce(connErr)
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('does not throw when all retries fail', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        service.postEvent({ type: 'daily-digest', rejectedTasks: '' }),
      ).resolves.toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --testPathPattern oracle-event`
Expected: FAIL — `postEvent` is not a function

- [ ] **Step 3: Implement `postEvent` with retry logic**

Add to `OracleEventService`:

```typescript
  /**
   * POST an event to the oracle channel server. Fire-and-forget with retry.
   * Retries up to 3 times with 2s backoff to handle startup race.
   */
  async postEvent(event: OracleChannelEvent): Promise<void> {
    const url = `http://127.0.0.1:${ORACLE_CHANNEL_PORT}`;
    const body = JSON.stringify(event);
    const maxAttempts = 3;
    const backoffMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fetch(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        });
        return;
      } catch (err) {
        if (attempt < maxAttempts) {
          this.logger.warn(
            `Channel POST attempt ${attempt}/${maxAttempts} failed, retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        } else {
          this.logger.error(
            `Channel POST failed after ${maxAttempts} attempts: ${(err as Error).message}`,
          );
        }
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --testPathPattern oracle-event`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/oracle/oracle-event.service.ts test/oracle-event.service.spec.ts
git commit -m "feat(oracle): add postEvent with retry to OracleEventService"
```

---

### Task 4: Channel MCP Server

**Files:**
- Create: `src/modules/oracle/oracle-channel.ts`
- Create: `test/oracle-channel.spec.ts`

- [ ] **Step 1: Install the MCP SDK dependency**

```bash
bun add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write the failing test for the channel server HTTP handler**

```typescript
// test/oracle-channel.spec.ts
import { ORACLE_CHANNEL_PORT } from '../src/modules/oracle/oracle-channel.types';

describe('oracle-channel server', () => {
  const baseUrl = `http://127.0.0.1:${ORACLE_CHANNEL_PORT}`;

  it('exports ORACLE_CHANNEL_PORT as 7851', () => {
    expect(ORACLE_CHANNEL_PORT).toBe(7851);
  });

  // Integration test: start the server, POST to it, verify it responds.
  // The channel server is a standalone Bun script, so we spawn it as a subprocess.
  // NOTE: This test requires Bun runtime and is skipped in Jest/Node.
  // The server's MCP notification behavior is tested via manual integration
  // (Claude Code receives the <channel> tag). The HTTP layer is what we validate here.
  it.skip('responds 200 to POST requests (integration — run with bun test)', () => {
    // This is a manual integration test placeholder.
    // To test: bun run src/modules/oracle/oracle-channel.ts &
    // curl -X POST http://127.0.0.1:7851 -d '{"type":"sync-complete","messagesStored":5,"channels":["#general"],"rejectedTasks":""}'
    // Expected: 200 "ok"
  });
});
```

- [ ] **Step 3: Run test to verify it passes (trivial — constant check only)**

Run: `bun run test -- --testPathPattern oracle-channel`
Expected: PASS

- [ ] **Step 4: Write the channel server**

```typescript
#!/usr/bin/env bun
// src/modules/oracle/oracle-channel.ts
//
// Standalone MCP channel server for Oracle events.
// Claude Code spawns this as a subprocess via .mcp.json.
// Listens on localhost:7851 for HTTP POSTs from tawtui's
// ingestion service and forwards them as channel notifications.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ORACLE_CHANNEL_PORT } from './oracle-channel.types';

const mcp = new Server(
  { name: 'oracle-channel', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: [
      'You receive events from the Oracle channel as <channel source="oracle-channel" event_type="..."> tags.',
      'Each event contains a JSON payload in the body.',
      '',
      'Event types:',
      '',
      '- sync-complete: New Slack messages were synced into mempalace.',
      '  The payload contains messagesStored (count), channels (Slack channel names),',
      '  and rejectedTasks (previously rejected proposals — do NOT re-propose these).',
      '  Search mempalace for conversations from the listed channels,',
      '  extract commitments, cross-check against rejectedTasks and existing +oracle tasks,',
      '  and propose any new action items. If nothing new, stay completely silent.',
      '',
      '- daily-digest: First launch of the day. Provide a broad summary of recent',
      '  conversations, key threads, unresolved discussions, and any commitments found.',
      '  More narrative than sync-complete. Still propose tasks for explicit commitments.',
      '  The payload contains rejectedTasks to avoid re-proposing.',
      '',
      'When you find actionable items, start your response with [ORACLE ALERT].',
      'When you have nothing to report, produce no output at all.',
    ].join('\n'),
  },
);

await mcp.connect(new StdioServerTransport());

Bun.serve({
  port: ORACLE_CHANNEL_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    const body = await req.text();

    let eventType = 'unknown';
    try {
      const parsed = JSON.parse(body) as { type?: string };
      eventType = parsed.type ?? 'unknown';
    } catch {
      // body isn't JSON — forward as-is
    }

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { event_type: eventType },
      },
    });

    return new Response('ok');
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/oracle/oracle-channel.ts test/oracle-channel.spec.ts
git commit -m "feat(oracle): add channel MCP server for event-driven oracle"
```

---

### Task 5: Channel Server Installation in Setup Flow

**Files:**
- Modify: `src/modules/tui.service.ts:256-262`

- [ ] **Step 1: Add the channel server install step after mempalace plugin install**

In `src/modules/tui.service.ts`, after the existing Step 3 (mempalace plugin install, line 262), add:

```typescript
        // Step 4: Install Oracle channel server in workspace .mcp.json
        onProgress({
          message: 'Installing Oracle channel...',
          status: 'running',
        });
        {
          const mcpJsonPath = join(ORACLE_WORKSPACE_DIR, '.mcp.json');
          let mcpConfig: Record<string, unknown> = {};
          if (existsSync(mcpJsonPath)) {
            try {
              mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
            } catch {
              // Corrupted — will be overwritten
            }
          }
          const mcpServers =
            (mcpConfig.mcpServers as Record<string, unknown>) ?? {};
          // Resolve absolute path to the channel server script
          const channelServerPath = join(
            __dirname,
            'oracle',
            'oracle-channel.ts',
          );
          mcpServers['oracle-channel'] = {
            command: 'bun',
            args: [channelServerPath],
          };
          mcpConfig.mcpServers = mcpServers;
          writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
        }
        onProgress({ message: 'Oracle channel installed', status: 'done' });
```

Also add the necessary imports at the top of `tui.service.ts` if not already present:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
```

- [ ] **Step 2: Verify `__dirname` resolves correctly**

The `tui.service.ts` file lives at `src/modules/tui.service.ts`. The channel server lives at `src/modules/oracle/oracle-channel.ts`. So `join(__dirname, 'oracle', 'oracle-channel.ts')` resolves correctly when running with `bun run src/main.ts` (Bun resolves `__dirname` to the file's directory).

- [ ] **Step 3: Commit**

```bash
git add src/modules/tui.service.ts
git commit -m "feat(oracle): install channel server in oracle workspace during setup"
```

---

### Task 6: Add Channel Flag to Oracle Session Command

**Files:**
- Modify: `src/modules/terminal.service.ts:913-921`

- [ ] **Step 1: Add `--dangerously-load-development-channels` flag to createOracleSession**

In `src/modules/terminal.service.ts`, in the `createOracleSession()` method, after the prompt is built and before `createSession()` is called, modify the command construction:

Replace the existing command construction (lines 916-921):

```typescript
    const escaped = oraclePrompt.replace(/'/g, "'\\''");
    let command = claudeAgent.command;
    if (claudeAgent.autoApproveFlag) {
      command += ` ${claudeAgent.autoApproveFlag}`;
    }
    command += ` '${escaped}'`;
```

With:

```typescript
    const escaped = oraclePrompt.replace(/'/g, "'\\''");
    let command = claudeAgent.command;
    if (claudeAgent.autoApproveFlag) {
      command += ` ${claudeAgent.autoApproveFlag}`;
    }
    command += ' --dangerously-load-development-channels server:oracle-channel';
    command += ` '${escaped}'`;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/terminal.service.ts
git commit -m "feat(oracle): add channel flag to oracle session command"
```

---

### Task 7: Rewrite Oracle Prompt

**Files:**
- Modify: `src/modules/terminal.service.ts:835-914`

- [ ] **Step 1: Replace the oracle prompt**

In `src/modules/terminal.service.ts`, replace the entire `oraclePrompt` array (lines 835-914) with:

```typescript
    const oraclePrompt = [
      `You are Oracle, a personal assistant for ${userName}, integrated into tawtui.`,
      '',
      `Your job is to monitor ${userName}'s Slack conversations (stored in mempalace) and surface`,
      'action items as Taskwarrior tasks. You are EVENT-DRIVEN: you sit idle until a channel',
      'event arrives, then you act on it.',
      '',
      '## How You Receive Events',
      '',
      'Events arrive as <channel source="oracle-channel" event_type="..."> tags.',
      'Each contains a JSON payload. You handle two event types:',
      '',
      '### sync-complete',
      'New Slack messages were synced. The payload contains:',
      '- messagesStored: number of new messages',
      '- channels: Slack channel names with new messages',
      '- rejectedTasks: previously rejected proposals (NEVER re-propose these)',
      '',
      'On sync-complete:',
      '1. Search mempalace (wing:"slack") for conversations from the listed channels.',
      `2. For each result, verify the message is FROM ${userName} (not just mentioning them).`,
      `3. Extract only commitments ${userName} explicitly made.`,
      '4. Cross-check against the rejectedTasks in the payload — skip any match.',
      '5. Run: task list +oracle — skip any similar existing tasks.',
      '6. If you find new commitments, start with [ORACLE ALERT] then propose them.',
      '7. If nothing new, produce NO output. Stay completely silent.',
      '',
      '### daily-digest',
      'First TUI launch of the day. The payload contains:',
      '- rejectedTasks: previously rejected proposals',
      '',
      'On daily-digest:',
      '1. Search mempalace broadly for recent conversations.',
      `2. Summarize key threads and unresolved discussions involving ${userName}.`,
      '3. Surface any commitments found (same rules as sync-complete).',
      '4. Start with [ORACLE ALERT] then give a narrative morning summary.',
      '',
      '## Task Creation Syntax',
      '',
      'Full Taskwarrior CLI syntax:',
      '  task add "<description>" [project:<project>] [priority:H|M|L] [due:<date>] [recur:<interval>] [+tag1] [+tag2]',
      '',
      '- description: Required. Clear, actionable task title.',
      '- project: Optional. Use the Slack channel name or relevant project name.',
      '- tags: Always include +oracle. Add contextual tags from: bug, feature, urgent, review, chore, meeting.',
      '- priority: H (high) for time-sensitive commitments, M (medium) for normal follow-ups, L (low) for nice-to-haves.',
      '- due: Named dates (today, tomorrow, eow, eom, eoq), ISO dates (2026-04-10), or durations (5days, 2weeks).',
      '- recur: For recurring commitments (daily, weekdays, weekly, biweekly, monthly, quarterly, yearly). Requires a due date.',
      '',
      'After creating a task, add context from the conversation:',
      '  task <uuid> annotate "<context from the conversation>"',
      '',
      '## Commitment Detection Rules',
      '',
      `CRITICAL: Only create tasks for things ${userName} EXPLICITLY committed to doing.`,
      '',
      'IS a commitment (create task):',
      `- ${userName} says "I'll send that over by Friday"`,
      `- ${userName} says "Let me review that PR today"`,
      `- ${userName} says "I can have the design ready by next week"`,
      `- ${userName} says "yeah I can take that" or "on it"`,
      `- ${userName} says "handling this now, should be done by EOD"`,
      '',
      'NOT a commitment (do NOT create task):',
      `- Someone asks ${userName} to do something but ${userName} has not responded or agreed`,
      `- "Can you look at this?" directed at ${userName} — this is a request, not a commitment`,
      `- ${userName} acknowledges without committing ("sounds good", "thanks", "got it")`,
      '- Tasks or action items for OTHER people in the conversation',
      '- FYI messages, announcements, or general discussion',
      '',
      'When in doubt, do NOT create a task. A missed task is better than a false one.',
      '',
      '## Querying Mempalace',
      '',
      'Use mempalace_search with wing:"slack" to search conversations.',
      'Each result includes a source_file field showing the original filename.',
      '',
      'Source prioritization:',
      `- Prioritize results where source_file contains "${userName}" (DMs involving ${userName}).`,
      '- For channel messages, verify the conversation text shows a message FROM',
      `  ${userName} (not just mentioning ${userName} or in a channel ${userName} is in).`,
      '- If you cannot determine who said what from the conversation text, skip it.',
      '',
      '## Proposing Tasks',
      '',
      'NEVER create tasks without confirmation. Always present proposals first.',
      'Format each proposed task clearly:',
      '---',
      '**Task:** <description>',
      '**Source:** <channel/DM name> — "<relevant quote>"',
      '**Command:** `task add "<description>" +oracle ...`',
      '---',
      '',
      `Wait for ${userName} to confirm. They may approve all, approve some, reject some, or edit.`,
      'Only create tasks that were explicitly approved.',
      'Annotate each created task with conversation context.',
      '',
      '## Rejected Task Tracking',
      '',
      `When ${userName} rejects a proposed task, append a line to rejected/YYYY-MM-DD.md`,
      '(using today\'s date) with the original quote from the conversation.',
      'Format: one line per rejection, e.g.:',
      '  "I\'ll review the API docs" — #backend, rejected 2026-04-11',
      '',
      'This file is read by the system and included in future event payloads,',
      'but write to it as a backup in case the payload is missing.',
    ].join('\n');
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/terminal.service.ts
git commit -m "feat(oracle): rewrite prompt for event-driven channel architecture"
```

---

### Task 8: Extend Ingestion Return Type with Channel Names

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts`

- [ ] **Step 1: Extend the ingest return type to include channel names**

In `src/modules/slack/slack-ingestion.service.ts`, change the `ingest()` method signature return type from `Promise<{ messagesStored: number }>` to `Promise<{ messagesStored: number; channelNames: string[] }>`.

At line 56, change:

```typescript
  ): Promise<{ messagesStored: number }> {
```

To:

```typescript
  ): Promise<{ messagesStored: number; channelNames: string[] }> {
```

At line 57, change:

```typescript
    if (this._ingesting) return { messagesStored: 0 };
```

To:

```typescript
    if (this._ingesting) return { messagesStored: 0, channelNames: [] };
```

Add a tracking set after `let filesWritten = 0;` (around line 157):

```typescript
      const touchedChannelNames: Set<string> = new Set();
```

After `messagesStored += rawMessages.length;` (around line 239), add:

```typescript
        touchedChannelNames.add(conversation.name);
```

Also after `messagesStored += newReplies.length;` in the thread replies section (around line 385), add:

```typescript
          touchedChannelNames.add(conversation.name);
```

Change the return at line 400 from:

```typescript
      return { messagesStored };
```

To:

```typescript
      return { messagesStored, channelNames: [...touchedChannelNames] };
```

Also update the early returns for generation checks (lines 112, 117, 144, 149, 163) from `{ messagesStored }` or `{ messagesStored: 0 }` to include `channelNames`:

```typescript
      return { messagesStored: 0, channelNames: [] };
      // and
      return { messagesStored, channelNames: [...touchedChannelNames] };
```

- [ ] **Step 2: Update safeIngest to pass channel names**

At line 471, update `safeIngest`:

```typescript
  private async safeIngest(): Promise<void> {
    try {
      const result = await this.ingest();
      if (result.messagesStored > 0) {
        this.onIngestComplete?.(result);
      }
    } catch (err) {
      this.logger.error(`Ingestion failed: ${(err as Error).message}`);
    }
  }
```

Update the `onIngestComplete` callback type at line 31:

```typescript
  onIngestComplete: ((result: { messagesStored: number; channelNames: string[] }) => void) | null = null;
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): extend ingest return type with channel names"
```

---

### Task 9: Fire sync-complete Event from Ingestion Service

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts:471-480`

- [ ] **Step 1: Add OracleEventService dependency and fire event in safeIngest**

Add to the constructor and imports in `slack-ingestion.service.ts`:

```typescript
import { OracleEventService } from '../oracle/oracle-event.service';
```

Update the constructor to accept an optional `OracleEventService`:

Note: Since `SlackIngestionService` is currently constructed with two args (`SlackService`, `MempalaceService`), add a third optional parameter:

```typescript
  constructor(
    private readonly slackService: SlackService,
    private readonly mempalaceService: MempalaceService,
    private readonly oracleEventService?: OracleEventService,
  ) {}
```

Update `safeIngest` to fire the event:

```typescript
  private async safeIngest(): Promise<void> {
    try {
      const result = await this.ingest();
      if (result.messagesStored > 0) {
        this.onIngestComplete?.(result);

        // Fire sync-complete event to oracle channel
        if (this.oracleEventService) {
          const rejectedTasks = this.oracleEventService.readRejectedTasks();
          void this.oracleEventService.postEvent({
            type: 'sync-complete',
            messagesStored: result.messagesStored,
            channels: result.channelNames,
            rejectedTasks,
          });
        }
      }
    } catch (err) {
      this.logger.error(`Ingestion failed: ${(err as Error).message}`);
    }
  }
```

- [ ] **Step 2: Wire up OracleEventService in tui.service.ts**

In `tui.service.ts`, after the bridge setup, create and pass the `OracleEventService` to `SlackIngestionService`. Since `SlackIngestionService` is a NestJS injectable, update how it's provided.

The simplest approach: set the service on `SlackIngestionService` after construction. Add a setter instead of a constructor param:

In `slack-ingestion.service.ts`, replace the constructor change with a property:

```typescript
  oracleEventService: OracleEventService | null = null;
```

Then in the `safeIngest` method, use `this.oracleEventService` (same code as above but checking `this.oracleEventService` instead of `this.oracleEventService?`).

In `tui.service.ts`, after the bridge is set up (around line 280), set the service:

```typescript
    // Wire up oracle event service for channel notifications
    if (depStatus.oracleReady) {
      const { OracleEventService } = await import('./oracle/oracle-event.service');
      this.slackIngestionService.oracleEventService =
        new OracleEventService(ORACLE_WORKSPACE_DIR);
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts src/modules/tui.service.ts
git commit -m "feat(oracle): fire sync-complete channel event after ingestion"
```

---

### Task 10: Auto-Launch Oracle Session on TUI Boot

**Files:**
- Modify: `src/modules/tui.service.ts:280-288`

- [ ] **Step 1: Add auto-launch after the existing polling start**

In `src/modules/tui.service.ts`, modify the block at lines 280-288 where polling is started. Add oracle session auto-launch:

```typescript
    // Start Oracle ingestion and auto-launch session if configured and dependencies are met
    const oracleConfig = this.configService.getOracleConfig();
    if (oracleConfig.slack?.xoxcToken && oracleConfig.slack?.xoxdCookie) {
      const depStatus = await this.dependencyService.checkAll();
      if (depStatus.oracleReady) {
        const intervalMs = oracleConfig.pollIntervalSeconds * 1000;
        this.slackIngestionService.startPolling(intervalMs);

        // Wire up oracle event service for channel notifications
        const { OracleEventService } = await import(
          './oracle/oracle-event.service'
        );
        const oracleEventService = new OracleEventService(
          ORACLE_WORKSPACE_DIR,
        );
        this.slackIngestionService.oracleEventService = oracleEventService;

        // Auto-launch oracle session (reuses existing if running)
        try {
          await this.terminalService.createOracleSession();
        } catch (err) {
          this.logger.warn(
            `Oracle auto-launch failed: ${(err as Error).message}`,
          );
        }

        // Fire daily digest if >12h since last one
        const lastDigest = oracleConfig.lastDigestAt
          ? new Date(oracleConfig.lastDigestAt)
          : null;
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        const needsDigest =
          !lastDigest || Date.now() - lastDigest.getTime() > twelveHoursMs;

        if (needsDigest) {
          const rejectedTasks = oracleEventService.readRejectedTasks(
            lastDigest ?? undefined,
          );
          void oracleEventService.postEvent({
            type: 'daily-digest',
            rejectedTasks,
          });
          this.configService.updateOracleConfig({
            lastDigestAt: new Date().toISOString(),
          });
        }
      }
    }
```

This replaces the existing block at lines 280-288. Note: the `OracleEventService` instantiation from Task 9 is now moved here to avoid duplication — remove the separate wiring added in Task 9 if executing sequentially.

- [ ] **Step 2: Commit**

```bash
git add src/modules/tui.service.ts
git commit -m "feat(oracle): auto-launch session and fire daily digest on TUI boot"
```

---

### Task 11: Toast Notification for Oracle Alerts

**Files:**
- Modify: `src/modules/tui/app.tsx:52-61`

- [ ] **Step 1: Add oracle alert detection to app.tsx**

In `src/modules/tui/app.tsx`, add imports and state for oracle alert tracking:

```typescript
import { getTerminalService } from './bridge';
```

Inside `AppContent()`, after the existing `onIngestComplete` hook (around line 61), add oracle alert polling:

```typescript
  // Oracle alert detection — poll oracle session capture for [ORACLE ALERT]
  let lastOracleAlertHash = '';

  onMount(() => {
    const interval = setInterval(() => {
      const ts = getTerminalService();
      if (!ts) return;

      // Only check when not on the Oracle tab (index 3)
      if (activeTab() === 3) return;

      const sessions = ts.listSessions();
      const oracleSession = sessions.find(
        (s) => s.isOracleSession && s.status === 'running',
      );
      if (!oracleSession) return;

      void ts.captureOutput(oracleSession.id).then((capture) => {
        if (!capture.content) return;

        // Check if content contains [ORACLE ALERT] that we haven't seen
        const alertIdx = capture.content.lastIndexOf('[ORACLE ALERT]');
        if (alertIdx === -1) return;

        const alertHash = `${alertIdx}-${capture.content.length}`;
        if (alertHash === lastOracleAlertHash) return;

        lastOracleAlertHash = alertHash;
        toast.show('Oracle found new action items', 'info');
      }).catch(() => {
        // Ignore capture errors
      });
    }, 2000); // Check every 2 seconds

    onCleanup(() => clearInterval(interval));
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/tui/app.tsx
git commit -m "feat(oracle): add toast notification for oracle alerts from other tabs"
```

---

### Task 12: Update onIngestComplete Callback in app.tsx

**Files:**
- Modify: `src/modules/tui/app.tsx:58-59`

- [ ] **Step 1: Update the callback to match the new return type**

In `src/modules/tui/app.tsx`, the existing `onIngestComplete` callback at line 58 receives `{ messagesStored: number }`. Update it to also accept `channelNames`:

```typescript
    svc.onIngestComplete = (result: { messagesStored: number; channelNames: string[] }) => {
      toast.show(`Synced ${result.messagesStored} messages`, 'done');
    };
```

The `channelNames` is not used in the toast (we keep it simple), but the type must match.

- [ ] **Step 2: Commit**

```bash
git add src/modules/tui/app.tsx
git commit -m "fix(oracle): update onIngestComplete type to include channelNames"
```

---

### Task 13: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all existing tests**

```bash
bun run test
```

Expected: All tests pass. The ingestion service tests may need updating if they check the return type of `ingest()`.

- [ ] **Step 2: Fix any failing ingestion tests**

In `test/slack-ingestion.service.spec.ts`, if tests check `ingest()` return value, update expectations to include `channelNames`:

```typescript
// Change:
expect(result).toEqual({ messagesStored: expect.any(Number) });
// To:
expect(result).toEqual({ messagesStored: expect.any(Number), channelNames: expect.any(Array) });
```

- [ ] **Step 3: Run type check**

```bash
bun run build
```

Expected: No type errors.

- [ ] **Step 4: Run lint and format**

```bash
bun run lint && bun run format
```

- [ ] **Step 5: Commit any test/lint fixes**

```bash
git add -A
git commit -m "fix: update tests and formatting for oracle channel events"
```

---

### Task 14: Manual Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Verify channel server starts standalone**

```bash
# In a terminal, test that the channel server binds correctly:
cd ~/.local/share/tawtui/oracle-workspace
bun run /path/to/src/modules/oracle/oracle-channel.ts &

# In another terminal:
curl -X POST http://127.0.0.1:7851 -d '{"type":"sync-complete","messagesStored":5,"channels":["#general"],"rejectedTasks":""}'
# Expected: "ok"

# Kill the background process
kill %1
```

- [ ] **Step 2: Verify full flow with TUI**

```bash
bun run start
```

Verify:
1. Oracle session auto-launches on startup (check Oracle tab — session should be active)
2. If >12h since last digest, a daily-digest event arrives in the oracle session
3. Trigger a manual sync (Shift+S) — after sync completes, a sync-complete event should arrive
4. When oracle finds items and you're on a different tab, a toast appears

- [ ] **Step 3: Final commit with any integration fixes**

```bash
git add -A
git commit -m "feat(oracle): complete event-driven oracle with channels integration"
```
