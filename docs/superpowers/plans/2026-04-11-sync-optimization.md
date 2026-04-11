# Sync Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Slack sync time from ~5 minutes to under 15 seconds by pre-filtering changed channels via `search.messages` and running API calls concurrently.

**Architecture:** A single `search.messages` call detects which channels have new activity before fetching any history. Only changed channels proceed to `conversations.history` and thread checks. Both Phase 1 (channel history) and Phase 2 (thread replies) run their API calls concurrently with a limit of 3.

**Tech Stack:** Slack API (`search.messages`, `conversations.history`, `conversations.replies`), existing `SlackService` throttle layer, TypeScript async concurrency.

**Spec:** `docs/superpowers/specs/2026-04-11-sync-optimization-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/shared/plimit.ts` | Concurrency limiter utility |
| Create | `test/plimit.spec.ts` | Tests for concurrency limiter |
| Modify | `src/modules/slack/slack.service.ts:421-452` | Add `getChangedChannelIds()` method |
| Modify | `test/slack.service.spec.ts` | Add tests for `getChangedChannelIds()` |
| Modify | `src/modules/slack/slack-ingestion.service.ts:164-296` | Pre-filter + concurrent Phase 1 |
| Modify | `src/modules/slack/slack-ingestion.service.ts:298-424` | Concurrent Phase 2 scoped to changed channels |
| Modify | `test/slack-ingestion.service.spec.ts` | Update tests for new sync behavior |

---

### Task 1: Concurrency Limiter Utility

**Files:**
- Create: `src/shared/plimit.ts`
- Create: `test/plimit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/plimit.spec.ts
import { pLimit } from '../src/shared/plimit';

describe('pLimit', () => {
  it('runs tasks up to the concurrency limit', async () => {
    const order: number[] = [];
    const limit = pLimit(2);

    const tasks = [1, 2, 3, 4].map((n) =>
      limit(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 10));
        return n * 10;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([10, 20, 30, 40]);
    // All tasks completed
    expect(order).toHaveLength(4);
  });

  it('limits concurrent execution', async () => {
    let running = 0;
    let maxRunning = 0;
    const limit = pLimit(2);

    const tasks = Array.from({ length: 6 }, () =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(2);
  });

  it('propagates errors without blocking other tasks', async () => {
    const limit = pLimit(2);
    const results: string[] = [];

    const tasks = [
      limit(async () => {
        results.push('a');
        return 'a';
      }),
      limit(async () => {
        throw new Error('fail');
      }),
      limit(async () => {
        results.push('c');
        return 'c';
      }),
    ];

    const settled = await Promise.allSettled(tasks);
    expect(settled[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(settled[1]).toEqual(
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --testPathPatterns plimit`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the concurrency limiter**

```typescript
// src/shared/plimit.ts

/**
 * Creates a concurrency limiter that runs at most `concurrency` async
 * tasks at a time. Returns a wrapper function that queues tasks.
 *
 * Usage:
 *   const limit = pLimit(3);
 *   const results = await Promise.all(items.map(item => limit(() => fetch(item))));
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (val) => {
            active--;
            resolve(val);
            next();
          },
          (err) => {
            active--;
            reject(err);
            next();
          },
        );
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --testPathPatterns plimit`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/plimit.ts test/plimit.spec.ts
git commit -m "feat: add pLimit concurrency limiter utility"
```

---

### Task 2: `getChangedChannelIds` in SlackService

**Files:**
- Modify: `src/modules/slack/slack.service.ts`
- Modify: `test/slack.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/slack.service.spec.ts` inside the existing `describe('SlackService')` block:

```typescript
  describe('getChangedChannelIds', () => {
    it('returns channel IDs from search results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          messages: {
            matches: [
              { channel: { id: 'C111' }, ts: '1' },
              { channel: { id: 'C222' }, ts: '2' },
              { channel: { id: 'C111' }, ts: '3' }, // duplicate
            ],
            paging: { pages: 1, page: 1, count: 100 },
          },
        }),
      });

      const result = await service.getChangedChannelIds('2026-04-11');
      expect(result).toEqual(new Set(['C111', 'C222']));
    });

    it('returns empty set when no matches', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          messages: { matches: [], paging: { pages: 1, page: 1, count: 100 } },
        }),
      });

      const result = await service.getChangedChannelIds('2026-04-11');
      expect(result).toEqual(new Set());
    });

    it('paginates through multiple pages', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            messages: {
              matches: [{ channel: { id: 'C111' }, ts: '1' }],
              paging: { pages: 2, page: 1, count: 100 },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            messages: {
              matches: [{ channel: { id: 'C222' }, ts: '2' }],
              paging: { pages: 2, page: 2, count: 100 },
            },
          }),
        });

      const result = await service.getChangedChannelIds('2026-04-11');
      expect(result).toEqual(new Set(['C111', 'C222']));
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- --testPathPatterns slack.service`
Expected: FAIL — `getChangedChannelIds` is not a function

- [ ] **Step 3: Implement `getChangedChannelIds`**

Add this method to `SlackService` in `src/modules/slack/slack.service.ts`, after the existing `getActiveChannelIds` method (after line 452):

```typescript
  /**
   * Find channels that have new messages since the given date.
   * Uses search.messages to detect activity without fetching full history.
   * Returns a set of channel IDs.
   */
  async getChangedChannelIds(
    afterDate: string,
    shouldAbort?: () => boolean,
  ): Promise<Set<string>> {
    const channelIds = new Set<string>();
    let page = 1;
    let totalPages = 1;

    do {
      if (shouldAbort?.()) return channelIds;
      const data = await this.slackGet<SlackSearchResponse>(
        'search.messages',
        {
          query: `after:${afterDate}`,
          count: '100',
          page: String(page),
        },
      );

      if (!data.ok) {
        throw new Error(`Slack search.messages error: ${data.error}`);
      }

      for (const match of data.messages?.matches ?? []) {
        channelIds.add(match.channel.id);
      }

      totalPages = data.messages?.paging?.pages ?? 1;
      page++;
    } while (page <= totalPages);

    return channelIds;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- --testPathPatterns slack.service`
Expected: All tests PASS (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack.service.ts test/slack.service.spec.ts
git commit -m "feat(slack): add getChangedChannelIds for change detection pre-filter"
```

---

### Task 3: Pre-Filter in Ingestion Phase 1

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts:164-296`

- [ ] **Step 1: Add pre-filter before Phase 1**

In `src/modules/slack/slack-ingestion.service.ts`, after the `filteredConversations` construction (line 165-167) and before the Phase 1 `for` loop (line 176), add the change detection pre-filter:

```typescript
      // Pre-filter: detect which channels have new messages via search
      let changedChannelIds: Set<string> | null = null;
      if (!options?.skipExisting) {
        // Only pre-filter on regular syncs, not initial setup
        const lastCheckedDate = state.lastChecked
          ? new Date(state.lastChecked).toISOString().split('T')[0]
          : null;
        if (lastCheckedDate) {
          try {
            changedChannelIds = await this.slackService.getChangedChannelIds(
              lastCheckedDate,
              () => this._generation !== gen,
            );
            if (this._generation !== gen)
              return { messagesStored: 0, channelNames: [] };
          } catch {
            // Search failed — fall back to checking all channels
            changedChannelIds = null;
          }
        }
      }
```

- [ ] **Step 2: Apply the filter to skip unchanged channels**

In the Phase 1 `for` loop, after the `skipExisting` check (line 184-192), add a check for the pre-filter. Insert this after the `continue` for `skipExisting`:

```typescript
        // Skip channels with no new activity (detected by pre-filter)
        if (changedChannelIds && !changedChannelIds.has(conversation.id)) {
          continue;
        }
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): add search-based pre-filter to skip unchanged channels"
```

---

### Task 4: Pre-Filter in Ingestion Phase 2

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts:298-424`

- [ ] **Step 1: Scope Phase 2 thread checks to changed channels**

In Phase 2 (the `for (const conversation of filteredConversations)` loop starting at line 304), add a skip at the top of the loop body, right after the generation check:

```typescript
        // Skip thread checks for channels with no new activity
        if (changedChannelIds && !changedChannelIds.has(conversation.id)) {
          continue;
        }
```

Insert this after line 306 (`return { messagesStored, channelNames: [...touchedChannelNames] };`), before the bootstrap check at line 308.

- [ ] **Step 2: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): scope Phase 2 thread checks to changed channels only"
```

---

### Task 5: Concurrent Phase 1

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts:176-296`

- [ ] **Step 1: Add import for pLimit**

At the top of `src/modules/slack/slack-ingestion.service.ts`, add:

```typescript
import { pLimit } from '../shared/plimit';
```

- [ ] **Step 2: Replace the Phase 1 sequential for loop with concurrent execution**

Replace the Phase 1 `for` loop (lines 176-296) with concurrent processing. The key change: instead of a `for` loop that processes one channel at a time, create an array of async tasks and run them through `pLimit(3)`.

The entire block from `for (let i = 0; ...` through the last `this.saveState(state)` at line 295 gets replaced:

```typescript
      // Phase 1: Fetch new messages per channel (concurrent, limit 3)
      const limit = pLimit(3);
      const phase1Tasks = filteredConversations
        .filter((conversation) => {
          // Skip channels already processed when resuming
          if (options?.skipExisting && state.channelCursors[conversation.id]) {
            return false;
          }
          // Skip channels with no new activity (detected by pre-filter)
          if (changedChannelIds && !changedChannelIds.has(conversation.id)) {
            return false;
          }
          return true;
        })
        .map((conversation) =>
          limit(async () => {
            if (this._generation !== gen) return;

            const defaultCursor = String(
              (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000,
            );
            const cursor = state.channelCursors[conversation.id] ?? defaultCursor;

            let rawMessages: Array<{
              ts: string;
              userId: string;
              text: string;
              threadTs?: string;
              replyCount?: number;
            }>;
            try {
              rawMessages = await this.slackService.getMessagesSince(
                conversation.id,
                cursor,
              );
            } catch (err) {
              this.logger.warn(
                `Skipping channel ${conversation.id}: ${(err as Error).message}`,
              );
              return;
            }

            if (rawMessages.length === 0) return;

            // Resolve usernames for all messages
            const slackExport: Array<Record<string, string>> = [];
            for (const raw of rawMessages) {
              const userName = await this.slackService.resolveUserName(
                raw.userId,
              );
              slackExport.push({
                type: 'message',
                user: userName,
                text: `${userName}: ${raw.text}`,
                ts: raw.ts,
              });
            }

            // Write one file per channel per cycle
            const channelSlug = this.slugify(
              conversation.name,
              conversation.isDm,
            );
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `${timestamp}_${channelSlug}.json`;
            writeFileSync(
              join(this.stagingDir, fileName),
              JSON.stringify(slackExport, null, 2),
              'utf-8',
            );

            filesWritten++;
            messagesStored += rawMessages.length;
            touchedChannelNames.add(conversation.name);

            // Advance cursor
            const lastTopLevel = rawMessages.filter((m) => !m.threadTs).pop();
            const lastTs =
              lastTopLevel?.ts ?? rawMessages[rawMessages.length - 1].ts;
            state.channelCursors[conversation.id] = lastTs;

            // Track thread parents for retroactive reply checking
            if (!state.trackedThreads) state.trackedThreads = {};
            if (!state.trackedThreads[conversation.id])
              state.trackedThreads[conversation.id] = [];
            const channelThreads = state.trackedThreads[conversation.id];
            for (const msg of rawMessages) {
              if (msg.replyCount && msg.replyCount > 0) {
                const replies = rawMessages.filter(
                  (m) => m.threadTs === msg.ts,
                );
                const lastReply =
                  replies.length > 0
                    ? replies[replies.length - 1]
                    : undefined;
                const existing = channelThreads.find(
                  (t) => t.threadTs === msg.ts,
                );
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
          }),
        );

      await Promise.allSettled(phase1Tasks);

      // Save state after Phase 1 completes
      if (messagesStored > 0) {
        state.userNames = this.slackService.exportUserCache();
        state.lastChecked = new Date().toISOString();
        this.saveState(state);
      }
```

Note: `onProgress` callbacks are removed from Phase 1 concurrent execution since multiple channels run simultaneously — interleaved progress would be confusing. The toast already shows the final result.

- [ ] **Step 3: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): run Phase 1 channel fetches concurrently (limit 3)"
```

---

### Task 6: Concurrent Phase 2

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts`

- [ ] **Step 1: Replace the Phase 2 sequential loops with concurrent execution**

Replace the Phase 2 block (from `// Phase 2: Re-check tracked threads` through `this.saveState(state);` at line 423) with concurrent processing:

```typescript
      // Phase 2: Re-check tracked threads for new replies (concurrent, limit 3)
      if (!state.trackedThreads) state.trackedThreads = {};
      const sevenDaysAgo = String(
        (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000,
      );

      const phase2Tasks: Array<Promise<void>> = [];

      for (const conversation of filteredConversations) {
        if (this._generation !== gen) break;

        // Skip thread checks for channels with no new activity
        if (changedChannelIds && !changedChannelIds.has(conversation.id)) {
          continue;
        }

        // Bootstrap: seed trackedThreads for channels with cursors but no tracked threads
        const channelCursor = state.channelCursors[conversation.id];
        if (
          channelCursor &&
          (!state.trackedThreads[conversation.id] ||
            state.trackedThreads[conversation.id].length === 0)
        ) {
          const backfillCursor = String(
            parseFloat(channelCursor) - 7 * 24 * 60 * 60,
          );
          try {
            const backfillMessages = await this.slackService.getMessagesSince(
              conversation.id,
              backfillCursor,
            );
            const threadParents = backfillMessages.filter(
              (m) => m.replyCount && m.replyCount > 0,
            );
            if (threadParents.length > 0) {
              state.trackedThreads[conversation.id] = threadParents.map(
                (m) => ({ threadTs: m.ts, lastReplyTs: m.ts }),
              );
            }
          } catch {
            // Backfill failed — will retry next sync
          }
        }

        const threads = state.trackedThreads[conversation.id];
        if (!threads || threads.length === 0) continue;

        // Prune threads older than 7 days
        state.trackedThreads[conversation.id] = threads.filter(
          (t) => t.threadTs > sevenDaysAgo,
        );

        const activeThreads = state.trackedThreads[conversation.id];

        for (const tracked of activeThreads) {
          phase2Tasks.push(
            limit(async () => {
              if (this._generation !== gen) return;

              let replies: Array<{ ts: string; userId: string; text: string }>;
              try {
                replies = await this.slackService.getThreadReplies(
                  conversation.id,
                  tracked.threadTs,
                );
              } catch {
                return;
              }

              const newReplies = replies.filter(
                (r) => r.ts > tracked.lastReplyTs,
              );
              if (newReplies.length === 0) return;

              let fullThread: Array<{
                ts: string;
                userId: string;
                text: string;
              }>;
              try {
                fullThread = await this.slackService.getFullThread(
                  conversation.id,
                  tracked.threadTs,
                );
              } catch {
                return;
              }

              const slackExport: Array<Record<string, string>> = [];
              for (const msg of fullThread) {
                const userName = await this.slackService.resolveUserName(
                  msg.userId,
                );
                slackExport.push({
                  type: 'message',
                  user: userName,
                  text: `${userName}: ${msg.text}`,
                  ts: msg.ts,
                });
              }

              const channelSlug = this.slugify(
                conversation.name,
                conversation.isDm,
              );
              const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, '-');
              const fileName = `${timestamp}_thread-${tracked.threadTs}_${channelSlug}.json`;
              writeFileSync(
                join(this.stagingDir, fileName),
                JSON.stringify(slackExport, null, 2),
                'utf-8',
              );

              filesWritten++;
              messagesStored += newReplies.length;
              touchedChannelNames.add(conversation.name);
              tracked.lastReplyTs = newReplies[newReplies.length - 1].ts;
            }),
          );
        }
      }

      await Promise.allSettled(phase2Tasks);

      // Save state after Phase 2 completes
      this.saveState(state);
```

Note: The `limit` variable from Phase 1 (the `pLimit(3)` instance) is reused for Phase 2. Both phases share the same concurrency pool, which means if Phase 1 tasks are still settling when Phase 2 starts, the total concurrency stays at 3. In practice Phase 1's `Promise.allSettled` completes before Phase 2 builds its tasks, so they don't overlap.

- [ ] **Step 2: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts
git commit -m "feat(oracle): run Phase 2 thread checks concurrently (limit 3)"
```

---

### Task 7: Update Ingestion Tests

**Files:**
- Modify: `test/slack-ingestion.service.spec.ts`

- [ ] **Step 1: Add `getChangedChannelIds` to the mock**

In `test/slack-ingestion.service.spec.ts`, add `getChangedChannelIds` to the `mockSlackService`:

```typescript
  getChangedChannelIds: jest.fn().mockResolvedValue(new Set<string>()),
```

Add it alongside the existing mock methods like `getActiveChannelIds`.

- [ ] **Step 2: Update existing tests to seed `lastChecked` in state**

The pre-filter only runs when `state.lastChecked` is set. For existing tests that expect channels to be fetched, ensure the `getChangedChannelIds` mock returns the channel IDs used in the test. For the basic test:

```typescript
    mockSlackService.getChangedChannelIds.mockResolvedValue(new Set(['C123']));
```

Add this to the `beforeEach` or to individual tests that set up conversations with channel ID `C123`.

- [ ] **Step 3: Run all tests to verify**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add test/slack-ingestion.service.spec.ts
git commit -m "test: update ingestion tests for pre-filter and concurrent sync"
```

---

### Task 8: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: All tests pass.

- [ ] **Step 2: Run type check**

```bash
bun run build
```

Expected: No type errors.

- [ ] **Step 3: Run lint and format**

```bash
bun run lint
bun run format
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint and formatting for sync optimization"
```

---

### Task 9: Manual Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Start tawtui and trigger manual sync**

```bash
bun run start
```

Press Shift+S to trigger a sync. Verify:
- If nothing changed in Slack: toast shows "All up to date" within ~5 seconds
- If messages exist in a channel: toast shows "Synced N msgs from #channel" within ~15 seconds

- [ ] **Step 2: Verify background polling sync**

Wait for the background polling interval (5 minutes). When it fires, the sync should complete quickly and show "All up to date" or the synced message count.

- [ ] **Step 3: Send a Slack message and re-sync**

Send a message in a Slack channel, wait ~2 minutes (for search indexing), then press Shift+S. Verify the message is picked up and the toast shows the channel name.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(oracle): complete sync optimization with pre-filter and concurrency"
```
