# Thread Reply Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch Slack thread replies during ingestion so the oracle has complete conversation context, not just top-level messages.

**Architecture:** Extend `getMessagesSince()` to detect threaded messages (`reply_count > 0`) and fetch their replies via `conversations.replies`. Replies are inserted inline after the parent message. The ingestion service's cursor advancement is updated to track only top-level message timestamps.

**Tech Stack:** Slack API (`conversations.replies`), existing SlackService/SlackIngestionService patterns.

**Spec:** `docs/superpowers/specs/2026-04-10-thread-reply-ingestion-design.md`

---

### File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/modules/slack/slack.types.ts` | Modify | Add `reply_count`, `thread_ts` to history response; add `SlackRepliesResponse` |
| `src/modules/slack/slack.service.ts` | Modify | Add rate limit; add `getThreadReplies()`; modify `getMessagesSince()` |
| `src/modules/slack/slack-ingestion.service.ts` | Modify | Update cursor advancement to skip reply timestamps |
| `test/slack.service.spec.ts` | Modify | Add tests for thread reply fetching |
| `test/slack-ingestion.service.spec.ts` | Modify | Update mock return types, test cursor with replies |

---

### Task 1: Add Slack API types for thread replies

**Files:**
- Modify: `src/modules/slack/slack.types.ts`

- [ ] **Step 1: Add thread fields to SlackHistoryResponse**

In `src/modules/slack/slack.types.ts`, update the `SlackHistoryResponse` message array type. Change:

```typescript
/** Paginated response from Slack conversations.history */
export interface SlackHistoryResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string;
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}
```

To:

```typescript
/** Paginated response from Slack conversations.history */
export interface SlackHistoryResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string;
    reply_count?: number;
    thread_ts?: string;
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}
```

- [ ] **Step 2: Add SlackRepliesResponse type**

Add after `SlackHistoryResponse`:

```typescript
/** Paginated response from Slack conversations.replies */
export interface SlackRepliesResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string;
    thread_ts?: string;
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/slack/slack.types.ts
git commit -m "feat(slack): add thread reply types to Slack API interfaces"
```

---

### Task 2: Add getThreadReplies method and rate limit

**Files:**
- Modify: `src/modules/slack/slack.service.ts`
- Modify: `test/slack.service.spec.ts`

- [ ] **Step 1: Add rate limit for conversations.replies**

In `src/modules/slack/slack.service.ts`, add to the `RATE_LIMITS` constant:

```typescript
const RATE_LIMITS: Record<string, number> = {
  'conversations.list': 500,
  'conversations.history': 400,
  'conversations.replies': 400, // Tier 3: same as history
  'users.info': 200,
  'search.messages': 1000,
};
```

- [ ] **Step 2: Add import for SlackRepliesResponse**

Update the import at the top of `slack.service.ts`:

```typescript
import type {
  SlackConversation,
  SlackConversationListResponse,
  SlackHistoryResponse,
  SlackRepliesResponse,
  SlackMessage,
  SlackSearchResponse,
  SlackUserInfoResponse,
} from './slack.types';
```

- [ ] **Step 3: Add getThreadReplies method**

Add after the `getMessagesSince` method (after line 231):

```typescript
  /**
   * Fetch replies in a thread, excluding the parent message.
   * Returns replies in chronological order (oldest first).
   */
  async getThreadReplies(
    channelId: string,
    threadTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string }>> {
    const results: Array<{ ts: string; userId: string; text: string }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        ts: threadTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackRepliesResponse>(
        'conversations.replies',
        params,
      );

      if (!data.ok) {
        throw new Error(`Slack conversations.replies error: ${data.error}`);
      }

      for (const msg of data.messages) {
        // Skip the parent message (same ts as thread_ts) and system messages
        if (msg.ts === threadTs) continue;
        if (msg.subtype || !msg.user || !msg.text) continue;
        results.push({ ts: msg.ts, userId: msg.user, text: msg.text });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    return results;
  }
```

- [ ] **Step 4: Write test for getThreadReplies**

Add to `test/slack.service.spec.ts`:

```typescript
  it('getThreadReplies returns replies excluding parent message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000100.000000', user: 'U111', text: 'parent message', thread_ts: '1700000100.000000' },
          { ts: '1700000200.000000', user: 'U222', text: 'first reply', thread_ts: '1700000100.000000' },
          { ts: '1700000300.000000', user: 'U333', text: 'second reply', thread_ts: '1700000100.000000' },
        ],
        has_more: false,
      }),
    });

    const replies = await service.getThreadReplies('C123', '1700000100.000000');
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({ ts: '1700000200.000000', userId: 'U222', text: 'first reply' });
    expect(replies[1]).toMatchObject({ ts: '1700000300.000000', userId: 'U333', text: 'second reply' });
  });

  it('getThreadReplies filters out system messages in threads', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000100.000000', user: 'U111', text: 'parent', thread_ts: '1700000100.000000' },
          { ts: '1700000200.000000', user: 'U222', text: 'real reply', thread_ts: '1700000100.000000' },
          { ts: '1700000250.000000', subtype: 'bot_message', text: 'bot noise', thread_ts: '1700000100.000000' },
        ],
        has_more: false,
      }),
    });

    const replies = await service.getThreadReplies('C123', '1700000100.000000');
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe('real reply');
  });
```

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: All tests pass (existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/modules/slack/slack.service.ts test/slack.service.spec.ts
git commit -m "feat(slack): add getThreadReplies method with rate limiting"
```

---

### Task 3: Modify getMessagesSince to fetch and inline thread replies

**Files:**
- Modify: `src/modules/slack/slack.service.ts`
- Modify: `test/slack.service.spec.ts`

- [ ] **Step 1: Update getMessagesSince return type and implementation**

Replace the entire `getMessagesSince` method in `src/modules/slack/slack.service.ts`:

```typescript
  /**
   * Fetch messages in a channel newer than `oldestTs`, including thread replies.
   * For each message with reply_count > 0, fetches the thread and inserts
   * replies inline after the parent. Filters out system messages.
   * Returns messages in chronological order (oldest first).
   */
  async getMessagesSince(
    channelId: string,
    oldestTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string; threadTs?: string }>> {
    const topLevel: Array<{
      ts: string;
      userId: string;
      text: string;
      replyCount: number;
    }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        oldest: oldestTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackHistoryResponse>(
        'conversations.history',
        params,
      );

      if (!data.ok) {
        if (data.error === 'not_in_channel') return [];
        throw new Error(`Slack conversations.history error: ${data.error}`);
      }

      for (const msg of data.messages) {
        if (msg.subtype || !msg.user || !msg.text) continue;
        topLevel.push({
          ts: msg.ts,
          userId: msg.user,
          text: msg.text,
          replyCount: msg.reply_count ?? 0,
        });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    // Chronological order (history returns newest first)
    topLevel.reverse();

    // Fetch thread replies and insert inline after parent
    const results: Array<{ ts: string; userId: string; text: string; threadTs?: string }> = [];
    for (const msg of topLevel) {
      results.push({ ts: msg.ts, userId: msg.userId, text: msg.text });

      if (msg.replyCount > 0) {
        if (this.shouldAbort?.()) throw new Error('Slack API call aborted');
        try {
          const replies = await this.getThreadReplies(channelId, msg.ts);
          for (const reply of replies) {
            results.push({ ...reply, threadTs: msg.ts });
          }
        } catch {
          // Thread fetch failed — continue with top-level messages
        }
      }
    }

    return results;
  }
```

- [ ] **Step 2: Write test for getMessagesSince with thread replies**

Add to `test/slack.service.spec.ts`:

```typescript
  it('getMessagesSince fetches thread replies inline after parent', async () => {
    // First call: conversations.history
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000300.000000', user: 'U333', text: 'no thread' },
          { ts: '1700000200.000000', user: 'U111', text: 'has thread', reply_count: 2 },
          { ts: '1700000100.000000', user: 'U444', text: 'oldest' },
        ],
        has_more: false,
      }),
    });
    // Second call: conversations.replies for the threaded message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000200.000000', user: 'U111', text: 'has thread', thread_ts: '1700000200.000000' },
          { ts: '1700000210.000000', user: 'U222', text: 'reply 1', thread_ts: '1700000200.000000' },
          { ts: '1700000220.000000', user: 'U333', text: 'reply 2', thread_ts: '1700000200.000000' },
        ],
        has_more: false,
      }),
    });

    const messages = await service.getMessagesSince('C123', '1700000000.000000');

    // Chronological: oldest, has thread, reply 1, reply 2, no thread
    expect(messages).toHaveLength(5);
    expect(messages[0]).toMatchObject({ ts: '1700000100.000000', text: 'oldest' });
    expect(messages[1]).toMatchObject({ ts: '1700000200.000000', text: 'has thread' });
    expect(messages[1].threadTs).toBeUndefined(); // parent has no threadTs
    expect(messages[2]).toMatchObject({ ts: '1700000210.000000', text: 'reply 1', threadTs: '1700000200.000000' });
    expect(messages[3]).toMatchObject({ ts: '1700000220.000000', text: 'reply 2', threadTs: '1700000200.000000' });
    expect(messages[4]).toMatchObject({ ts: '1700000300.000000', text: 'no thread' });
  });
```

- [ ] **Step 3: Update existing getMessagesSince test**

The existing test `'getMessagesSince returns only user messages (filters subtypes)'` still works — it has no `reply_count` on any messages, so no thread fetching occurs. The return type now includes optional `threadTs` but that doesn't break the assertion. No change needed.

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack.service.ts test/slack.service.spec.ts
git commit -m "feat(slack): fetch thread replies inline in getMessagesSince"
```

---

### Task 4: Update cursor advancement to skip reply timestamps

**Files:**
- Modify: `src/modules/slack/slack-ingestion.service.ts`
- Modify: `test/slack-ingestion.service.spec.ts`

- [ ] **Step 1: Update the rawMessages type and cursor logic**

In `src/modules/slack/slack-ingestion.service.ts`, find the cursor advancement block (around line 242):

```typescript
        const lastTs = rawMessages[rawMessages.length - 1].ts;
        state.channelCursors[conversation.id] = lastTs;
```

Replace with:

```typescript
        const lastTopLevel = rawMessages.filter((m) => !m.threadTs).pop();
        const lastTs = lastTopLevel?.ts ?? rawMessages[rawMessages.length - 1].ts;
        state.channelCursors[conversation.id] = lastTs;
```

- [ ] **Step 2: Update the rawMessages type annotation**

Find the type annotation for `rawMessages` (around line 194):

```typescript
        let rawMessages: Array<{ ts: string; userId: string; text: string }>;
```

Change to:

```typescript
        let rawMessages: Array<{ ts: string; userId: string; text: string; threadTs?: string }>;
```

- [ ] **Step 3: Write test for cursor advancement with thread replies**

Add to `test/slack-ingestion.service.spec.ts`:

```typescript
  it('cursor advances to last top-level message, not thread reply', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000100.000000', userId: 'U111', text: 'top level' },
      { ts: '1700000200.000000', userId: 'U222', text: 'parent', },
      { ts: '1700000250.000000', userId: 'U333', text: 'reply', threadTs: '1700000200.000000' },
      { ts: '1700000300.000000', userId: 'U444', text: 'last top level' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    await service.ingest();

    const statePath = (service as any).statePath;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    // Cursor should be '1700000300.000000' (last top-level), not '1700000250.000000' (reply)
    expect(state.channelCursors['C123']).toBe('1700000300.000000');
  });
```

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 5: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts test/slack-ingestion.service.spec.ts
git commit -m "fix(oracle): advance cursor by top-level message ts, not thread reply ts"
```
