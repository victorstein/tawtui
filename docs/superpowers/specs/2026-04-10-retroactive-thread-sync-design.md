# Retroactive Thread Reply Sync

## Problem

When a thread reply is posted after the channel cursor has advanced past the parent message, the reply is never fetched. The current ingestion only fetches messages newer than the cursor, so threads that receive new replies retroactively are invisible.

Example: Katlyn posts a message at 10:00. Sync runs at 10:05, fetches the message, advances cursor to 10:05. Alfonso replies in the thread at 10:10. Next sync fetches messages after 10:05 — Katlyn's parent is older, so the thread (and Alfonso's reply) is never checked.

## Solution

Track parent messages that have threads. On each sync, re-check tracked threads for new replies, even after the channel cursor has moved past them. Prune tracked threads older than 7 days.

## Design

### State Changes (`slack.types.ts`)

Add `trackedThreads` to `OracleState`:

```typescript
/** Parent messages with threads — checked for new replies on each sync */
trackedThreads?: Record<string, Array<{
  threadTs: string;
  lastReplyTs: string;
}>>;
```

Keyed by channel ID. Each entry stores:
- `threadTs` — the parent message's timestamp (used to call `getThreadReplies`)
- `lastReplyTs` — the most recent reply `ts` we've seen (used to filter out already-fetched replies)

### Return Type Change (`slack.service.ts`)

`getMessagesSince()` return type gains an optional `replyCount` field:

```typescript
Array<{ ts: string; userId: string; text: string; threadTs?: string; replyCount?: number }>
```

Parent messages with threads get `replyCount` set from the API's `reply_count` field. The ingestion service uses this to know which messages to track.

### Sync Flow (`slack-ingestion.service.ts`)

The per-channel loop gains a second phase after the existing message fetch:

**Phase 1 (existing):** `getMessagesSince(channel, cursor)` returns new top-level messages with inline thread replies. Messages with `replyCount > 0` are added to `trackedThreads` (or updated if already tracked). The `lastReplyTs` is set to the latest reply's `ts` from the inline fetch.

**Phase 2 (new):** For each tracked thread in this channel that was NOT already covered by Phase 1 (i.e., the thread parent is older than the cursor):
1. Call `getThreadReplies(channelId, threadTs)`
2. Filter to replies with `ts > lastReplyTs`
3. If new replies exist, resolve usernames and write to a staging file
4. Update `lastReplyTs` to the latest new reply

**Pruning:** After both phases, remove tracked threads where `threadTs` is older than 7 days.

**State persistence:** `trackedThreads` is saved alongside `channelCursors` after each channel completes.

### Performance

Phase 2 adds one `conversations.replies` API call per tracked thread per sync. With the 400ms throttle:
- Typical: 5-10 active threads per channel × 50 channels × 400ms = 80-200 seconds worst case
- Most syncs: threads with no new replies return quickly (few/no new messages to write)
- 7-day pruning keeps the tracked set bounded

### Reset Behavior

`resetState()` clears `channelCursors` and `trackedThreads` (they're not preserved across reset since they're tied to cursor state). The conversation list and active channel caches are preserved as before.

### Files to Change

| File | Change |
|---|---|
| `src/modules/slack/slack.types.ts` | Add `trackedThreads` to `OracleState` |
| `src/modules/slack/slack.service.ts` | Add `replyCount` to `getMessagesSince` return type |
| `src/modules/slack/slack-ingestion.service.ts` | Add Phase 2 tracked thread re-check, pruning, state updates |
| `test/slack-ingestion.service.spec.ts` | Tests for tracked thread sync and pruning |

### No UI Changes

Toast progress already counts all messages including thread replies. No changes needed.
