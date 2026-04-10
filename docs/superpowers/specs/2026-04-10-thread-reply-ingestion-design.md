# Thread Reply Ingestion

## Problem

The Slack `conversations.history` API only returns top-level channel messages. Thread replies — where most valuable conversations happen (questions, decisions, follow-ups) — are invisible to the oracle. When someone asks a question in a thread and the user replies, the reply isn't ingested.

## Solution

After fetching channel history, detect messages with threads (`reply_count > 0`) and fetch their replies via `conversations.replies`. Insert replies inline after the parent message so mempalace sees them as a natural conversation exchange.

## Design

### Slack API Layer (`slack.service.ts`)

**Type changes:**

Add thread fields to `SlackHistoryResponse` message shape:
```typescript
reply_count?: number;
thread_ts?: string;
```

Add new response type:
```typescript
interface SlackRepliesResponse {
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

**New method:** `getThreadReplies(channelId, threadTs)` — calls `conversations.replies`, filters out the parent message (already fetched), returns only replies. Handles pagination.

**Rate limit:** `'conversations.replies': 400` (Tier 3, same as `conversations.history`).

**Modified method:** `getMessagesSince()` — after fetching history, for each message with `reply_count > 0`, calls `getThreadReplies()` and inserts replies immediately after the parent in the results array. Checks `shouldAbort` between thread fetches for cancellation support.

**Return type change:**
```typescript
// From:
Array<{ ts: string; userId: string; text: string }>
// To:
Array<{ ts: string; userId: string; text: string; threadTs?: string }>
```

`threadTs` is set on reply messages (not the parent). Used by the ingestion service to correctly advance the channel cursor.

### Ingestion Service (`slack-ingestion.service.ts`)

**Cursor advancement:** Track the latest non-reply `ts` for the channel cursor so reply timestamps don't advance the cursor past unprocessed top-level messages:
```typescript
const lastTopLevel = rawMessages.filter(m => !m.threadTs).pop();
const lastTs = lastTopLevel?.ts ?? rawMessages[rawMessages.length - 1].ts;
```

**No other changes.** The existing username resolution, JSON export format, and file writing handle thread replies naturally — they're just additional messages in the array.

### Mempalace Compatibility

The export format stays the same: `[{type, user, text, ts}, ...]`. Thread replies appear as sequential messages from different speakers. Mempalace's `_try_slack_json` normalizer assigns alternating user/assistant roles, and `chunk_exchanges` groups them into exchange pairs. A thread like:

```
Katlyn: looks like Lucas had this one in progress...
Alfonso: Here! release v1.1.0 a while ago
Katlyn: awesome, thank you!
```

Becomes one exchange-pair chunk — exactly how mempalace is designed to store conversations.

### Performance

Thread fetching adds one `conversations.replies` API call per active thread. With 400ms throttle:
- Typical sync: ~50 active channels × ~2-3 threads each × 400ms = ~40-60 seconds
- First-time init with 7-day lookback: more threads, but bounded by active channel filter

The `shouldAbort` callback is checked between thread fetches, so Esc cancellation works.

### Files to Change

| File | Change |
|---|---|
| `src/modules/slack/slack.types.ts` | Add `reply_count`, `thread_ts` to history response; add `SlackRepliesResponse` |
| `src/modules/slack/slack.service.ts` | Add rate limit entry; add `getThreadReplies()`; modify `getMessagesSince()` to fetch and inline thread replies |
| `src/modules/slack/slack-ingestion.service.ts` | Update cursor advancement to use latest non-reply `ts` |
| `test/slack.service.spec.ts` | Add tests for `getThreadReplies()` |
| `test/slack-ingestion.service.spec.ts` | Update tests for new message shape with `threadTs` |

### No UI Changes

The toast progress already shows per-channel message counts. Thread replies are included in `messagesStored` naturally.
