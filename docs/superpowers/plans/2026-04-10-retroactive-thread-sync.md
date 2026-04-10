# Retroactive Thread Reply Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect new replies on already-processed threads and fetch them on each sync, so thread conversations stay up to date even after the channel cursor has advanced past the parent message.

**Architecture:** Track parent messages with threads in `OracleState.trackedThreads`. On each sync, after the normal message fetch (Phase 1), re-check tracked threads for new replies (Phase 2). Prune threads older than 7 days.

**Tech Stack:** Existing SlackService (`getThreadReplies`), SlackIngestionService, OracleState persistence.

**Spec:** `docs/superpowers/specs/2026-04-10-retroactive-thread-sync-design.md`

---

### File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/modules/slack/slack.types.ts` | Modify | Add `trackedThreads` to `OracleState` |
| `src/modules/slack/slack.service.ts` | Modify | Add `replyCount` to `getMessagesSince` return type |
| `src/modules/slack/slack-ingestion.service.ts` | Modify | Phase 1 thread tracking, Phase 2 re-check, pruning |
| `test/slack-ingestion.service.spec.ts` | Modify | Tests for tracked thread sync and pruning |

---

### Task 1: Add trackedThreads to OracleState and replyCount to getMessagesSince

**Files:**
- Modify: `src/modules/slack/slack.types.ts`
- Modify: `src/modules/slack/slack.service.ts`

- [ ] **Step 1: Add trackedThreads to OracleState**

In `src/modules/slack/slack.types.ts`, add to the `OracleState` interface before the closing `}`:

```typescript
  /** Parent messages with threads — checked for new replies on each sync */
  trackedThreads?: Record<string, Array<{
    threadTs: string;
    lastReplyTs: string;
  }>>;
```

- [ ] **Step 2: Add replyCount to getMessagesSince return type**

In `src/modules/slack/slack.service.ts`, find the `getMessagesSince` method. Update the return type and the results array type to include `replyCount`:

Change the method signature (around line 209):
```typescript
  ): Promise<
    Array<{ ts: string; userId: string; text: string; threadTs?: string; replyCount?: number }>
  > {
```

Change the results array type (around line 264):
```typescript
    const results: Array<{
      ts: string;
      userId: string;
      text: string;
      threadTs?: string;
      replyCount?: number;
    }> = [];
```

Change the push for parent messages (around line 267) to include replyCount when non-zero:
```typescript
    for (const msg of topLevel) {
      results.push({
        ts: msg.ts,
        userId: msg.userId,
        text: msg.text,
        ...(msg.replyCount > 0 ? { replyCount: msg.replyCount } : {}),
      });
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: All 81 tests pass (no behavioral change yet)

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack.types.ts src/modules/slack/slack.service.ts
git commit -m "feat(oracle): add trackedThreads to OracleState and replyCount to getMessagesSince"
```

---

### Task 2: Track thread parents in Phase 1 and add Phase 2 re-check

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts`

- [ ] **Step 1: Update rawMessages type to include replyCount**

Find the `rawMessages` type annotation (around line 193):

```typescript
        let rawMessages: Array<{ ts: string; userId: string; text: string; threadTs?: string }>;
```

Change to:

```typescript
        let rawMessages: Array<{ ts: string; userId: string; text: string; threadTs?: string; replyCount?: number }>;
```

- [ ] **Step 2: Add Phase 1 thread tracking after cursor advancement**

Find the cursor advancement and `saveState` block (around lines 242-247). After `state.channelCursors[conversation.id] = lastTs;` and before `state.userNames = ...`, add thread tracking:

```typescript
        // Advance cursor and persist immediately so progress survives app exit
        const lastTopLevel = rawMessages.filter((m) => !m.threadTs).pop();
        const lastTs = lastTopLevel?.ts ?? rawMessages[rawMessages.length - 1].ts;
        state.channelCursors[conversation.id] = lastTs;

        // Track thread parents for retroactive reply checking
        if (!state.trackedThreads) state.trackedThreads = {};
        if (!state.trackedThreads[conversation.id]) state.trackedThreads[conversation.id] = [];
        const channelThreads = state.trackedThreads[conversation.id];
        for (const msg of rawMessages) {
          if (msg.replyCount && msg.replyCount > 0) {
            const replies = rawMessages.filter((m) => m.threadTs === msg.ts);
            const lastReply = replies.length > 0 ? replies[replies.length - 1] : undefined;
            const existing = channelThreads.find((t) => t.threadTs === msg.ts);
            if (existing) {
              if (lastReply && lastReply.ts > existing.lastReplyTs) {
                existing.lastReplyTs = lastReply.ts;
              }
            } else {
              channelThreads.push({
                threadTs: msg.ts,
                lastReplyTs: lastReply?.ts ?? msg.ts,
              });
            }
          }
        }

        state.userNames = this.slackService.exportUserCache();
        state.lastChecked = new Date().toISOString();
        this.saveState(state);
```

- [ ] **Step 3: Add Phase 2 — re-check tracked threads for new replies**

After the closing `}` of the `for` loop (the per-channel loop) and BEFORE the mining block (`if (filesWritten > 0)`), add Phase 2:

```typescript
      // Phase 2: Re-check tracked threads for new replies
      if (state.trackedThreads) {
        const sevenDaysAgo = String((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

        for (const conversation of filteredConversations) {
          if (this._generation !== gen) return { messagesStored };
          const threads = state.trackedThreads[conversation.id];
          if (!threads || threads.length === 0) continue;

          // Prune threads older than 7 days
          state.trackedThreads[conversation.id] = threads.filter(
            (t) => t.threadTs > sevenDaysAgo,
          );

          for (const tracked of state.trackedThreads[conversation.id]) {
            if (this._generation !== gen) return { messagesStored };

            let replies: Array<{ ts: string; userId: string; text: string }>;
            try {
              replies = await this.slackService.getThreadReplies(
                conversation.id,
                tracked.threadTs,
              );
            } catch {
              continue;
            }

            // Filter to only new replies
            const newReplies = replies.filter((r) => r.ts > tracked.lastReplyTs);
            if (newReplies.length === 0) continue;

            // Resolve usernames and write to staging
            const slackExport: Array<Record<string, string>> = [];
            for (const reply of newReplies) {
              const userName = await this.slackService.resolveUserName(reply.userId);
              slackExport.push({
                type: 'message',
                user: userName,
                text: `${userName}: ${reply.text}`,
                ts: reply.ts,
              });
            }

            const channelSlug = this.slugify(conversation.name, conversation.isDm);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `${timestamp}_thread-${tracked.threadTs}_${channelSlug}.json`;
            writeFileSync(
              join(this.stagingDir, fileName),
              JSON.stringify(slackExport, null, 2),
              'utf-8',
            );

            filesWritten++;
            messagesStored += newReplies.length;
            tracked.lastReplyTs = newReplies[newReplies.length - 1].ts;
          }

          this.saveState(state);
        }
      }
```

- [ ] **Step 4: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): add Phase 2 retroactive thread reply sync with tracking and pruning"
```

---

### Task 3: Add tests for tracked thread sync

**Files:**
- Modify: `test/slack-ingestion.service.spec.ts`

- [ ] **Step 1: Add mock for getThreadReplies**

In the `mockSlackService` object at the top of the test file, add `getThreadReplies` if not already present:

```typescript
  getThreadReplies: jest.fn().mockResolvedValue([]),
```

- [ ] **Step 2: Write test for Phase 1 — thread parents are tracked**

```typescript
  it('Phase 1 tracks thread parents in trackedThreads state', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000100.000000', userId: 'U111', text: 'parent', replyCount: 2 },
      { ts: '1700000150.000000', userId: 'U222', text: 'reply 1', threadTs: '1700000100.000000' },
      { ts: '1700000160.000000', userId: 'U333', text: 'reply 2', threadTs: '1700000100.000000' },
      { ts: '1700000200.000000', userId: 'U444', text: 'no thread' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    await service.ingest();

    const statePath = (service as any).statePath;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.trackedThreads).toBeDefined();
    expect(state.trackedThreads['C123']).toHaveLength(1);
    expect(state.trackedThreads['C123'][0].threadTs).toBe('1700000100.000000');
    expect(state.trackedThreads['C123'][0].lastReplyTs).toBe('1700000160.000000');
  });
```

- [ ] **Step 3: Write test for Phase 2 — new replies are fetched retroactively**

```typescript
  it('Phase 2 fetches new replies for tracked threads', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    // Pre-populate state with a tracked thread
    const statePath = (service as any).statePath;
    const stagingDir = (service as any).stagingDir;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        lastChecked: null,
        channelCursors: { C123: '1700000200.000000' },
        conversations: [conversation],
        activeChannelIds: ['C123'],
        trackedThreads: {
          C123: [{ threadTs: '1700000100.000000', lastReplyTs: '1700000160.000000' }],
        },
      }),
      'utf-8',
    );

    // Phase 1: no new top-level messages
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([]);

    // Phase 2: thread has a new reply
    mockSlackService.getThreadReplies.mockResolvedValue([
      { ts: '1700000150.000000', userId: 'U222', text: 'old reply' },
      { ts: '1700000160.000000', userId: 'U333', text: 'old reply 2' },
      { ts: '1700000170.000000', userId: 'U444', text: 'new reply!' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    const result = await service.ingest();

    expect(result.messagesStored).toBe(1); // only the new reply
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.trackedThreads['C123'][0].lastReplyTs).toBe('1700000170.000000');

    // Verify staging file was written for the thread reply
    const files = readdirSync(stagingDir);
    const threadFile = files.find((f) => f.includes('thread-'));
    expect(threadFile).toBeDefined();
  });
```

- [ ] **Step 4: Write test for pruning — old threads are removed**

```typescript
  it('Phase 2 prunes tracked threads older than 7 days', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    const eightDaysAgo = String((Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000);
    const oneDayAgo = String((Date.now() - 1 * 24 * 60 * 60 * 1000) / 1000);

    const statePath = (service as any).statePath;
    const stagingDir = (service as any).stagingDir;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        lastChecked: null,
        channelCursors: { C123: '1700000200.000000' },
        conversations: [conversation],
        activeChannelIds: ['C123'],
        trackedThreads: {
          C123: [
            { threadTs: eightDaysAgo, lastReplyTs: eightDaysAgo },
            { threadTs: oneDayAgo, lastReplyTs: oneDayAgo },
          ],
        },
      }),
      'utf-8',
    );

    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([]);
    mockSlackService.getThreadReplies.mockResolvedValue([]);

    await service.ingest();

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    // Old thread pruned, recent thread kept
    expect(state.trackedThreads['C123']).toHaveLength(1);
    expect(state.trackedThreads['C123'][0].threadTs).toBe(oneDayAgo);
  });
```

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: All tests pass (81 existing + 3 new = 84)

- [ ] **Step 6: Commit**

```bash
git add test/slack-ingestion.service.spec.ts
git commit -m "test(oracle): add tests for retroactive thread reply sync and pruning"
```

---

### Task 4: Clear trackedThreads on reset

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts`

- [ ] **Step 1: Verify trackedThreads is NOT preserved in resetState**

In `src/modules/slack/slack-ingestion.service.ts`, find the `resetState` method. The `saveState` call preserves `conversations`, `activeChannelIds`, `channelsCachedAt`, and `activeChannelsCachedAt`. Verify that `trackedThreads` is NOT listed — it should be cleared on reset since it's tied to cursor state.

The current code:
```typescript
      this.saveState({
        lastChecked: null,
        channelCursors: {},
        conversations: prev.conversations,
        activeChannelIds: prev.activeChannelIds,
        channelsCachedAt: prev.channelsCachedAt,
        activeChannelsCachedAt: prev.activeChannelsCachedAt,
      });
```

Since `trackedThreads` is not listed, it's automatically cleared when the state file is overwritten. This is correct — no change needed.

- [ ] **Step 2: Verify build and tests pass**

Run: `bun run build && bun run test`
Expected: Build clean, all tests pass

- [ ] **Step 3: Commit (if any changes were needed)**

No commit needed if no changes — just verify.
