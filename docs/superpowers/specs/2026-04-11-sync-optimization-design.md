# Sync Optimization Design

> Reduce sync time from ~5 minutes to under 15 seconds by pre-filtering changed channels via `search.messages` and running API calls concurrently.

## Problem

Each sync cycle calls `conversations.history` for all 23 active channels and `conversations.replies` for all 74 tracked threads — ~97 Slack API calls — even when nothing has changed. With Tier 3 rate limits (1.2s per call) and sequential execution, this takes ~5 minutes.

## Solution

Two optimizations applied together:

1. **Change detection pre-filter**: One `search.messages` call before fetching anything. Only fetch channels that actually have new messages.
2. **Concurrent API calls**: Run channel/thread fetches in parallel (concurrency limit 3) instead of sequentially.

## Change Detection Pre-Filter

### How It Works

Before Phase 1 (channel history fetching), call `search.messages` with query `in:<channel> after:<date>` to find which channels have new activity since the last sync. Unlike `getActiveChannelIds` which uses `from:me` to detect user activity, this method checks for ANY new messages — we want to catch messages from others that may contain requests or context.

A new method `SlackService.getChangedChannelIds(afterDate, channelNames)` queries `search.messages`, paginates results, and returns a `Set<string>` of channel IDs with new messages. It accepts the list of channel names to scope the search to known channels.

The ingestion service intersects this set with its existing `filteredConversations` list. Only channels in the intersection proceed to `getMessagesSince`.

### Date Granularity

Slack's `search.messages` `after:` filter is date-based, not timestamp-based. On the first sync of the day, it may return channels with activity from the previous day that we already processed. The existing cursor-based dedup in `getMessagesSince` handles this — it only returns messages newer than the cursor. Duplicate API calls are harmless, just slightly wasteful, and this only happens once per day.

### Search Indexing Delay

New messages take ~1-2 minutes to appear in Slack search. If a message is sent 30 seconds before sync, the pre-filter won't catch it. The next sync cycle (5 minutes later) will pick it up. This is acceptable.

## Thread Change Detection

The pre-filter also gates Phase 2 (thread reply checking). Instead of checking all 74 tracked threads:

- Only check tracked threads in channels that the pre-filter identified as having new activity
- Skip threads in channels with no new messages
- Within active channels, the existing Phase 2 logic is unchanged: `getThreadReplies` per tracked thread, check for replies newer than `lastReplyTs`

If 3 of 23 channels have new activity and those 3 have ~10 tracked threads, thread checks drop from 74 to 10.

## Concurrent API Calls

### Concurrency Limit

3 concurrent calls. Slack Tier 3 allows ~50 req/min for `conversations.history` and `conversations.replies`. With 3 concurrent tasks and the existing 1.2s per-method throttle, calls naturally stagger and stay within limits.

### Implementation

A `pLimit`-style concurrency limiter — a function that takes an array of async tasks and runs at most N at a time. No external dependency, ~15 lines of code.

### What Runs Concurrently

- **Phase 1**: Channel history fetches (only the filtered set from pre-filter)
- **Phase 2**: Thread reply checks (only threads in active channels)

### What Stays Sequential

- The `search.messages` pre-filter (single call, must complete before phases start)
- `mempalace mine` at the end (single call)

### Rate Limit Interaction

The existing per-method throttle in `SlackService.throttle()` enforces minimum gaps between same-method calls. With 3 concurrent tasks all calling `conversations.history`, they naturally stagger: task 1 calls at T=0, task 2 waits for the 1.2s gap and calls at T=1.2s, task 3 at T=2.4s. The global 200ms minimum gap provides additional safety. No changes to the throttle logic are needed.

### State Handling

Currently `saveState()` is called after each channel for crash recovery. With concurrent processing, state is saved once after each phase completes instead of per-channel. If the app crashes mid-phase, progress on that phase is lost but cursors from previous phases are safe. This is a reasonable trade-off — a sync cycle is now seconds, not minutes.

## Revised Sync Flow

```
1. Load state, hydrate caches (unchanged)
2. Get conversation list (cached) + active channel IDs (cached hourly) (unchanged)
3. PRE-FILTER: search.messages → changedChannelIds set
4. Filter: intersection of (active + previously synced) AND changedChannelIds
   → typically 0-5 channels instead of 23
5. PHASE 1 (concurrent, limit 3):
   For each changed channel → getMessagesSince → write staging file
   Save state after phase completes
6. PHASE 2 (concurrent, limit 3):
   For each tracked thread IN changed channels only → getThreadReplies
   If new replies → getFullThread → write staging file
   Save state after phase completes
7. Mine all new staging files to mempalace (unchanged)
8. Return { messagesStored, channelNames } (unchanged)
```

## Expected Performance

| Scenario | API Calls (before) | API Calls (after) | Wall Time (before) | Wall Time (after) |
|----------|-------------------|-------------------|--------------------|--------------------|
| Nothing changed | 97 | 1 | ~5 min | ~3s |
| 3 channels changed, 10 threads | 97 | 14 | ~5 min | ~7s |
| All 23 channels changed | 97 | 98 | ~5 min | ~1.5 min |

## What Changes

- `SlackIngestionService.ingest()` — new pre-filter step, concurrent execution in Phase 1 and Phase 2, state saved per-phase instead of per-channel
- `SlackService` — new method `getChangedChannelIds(afterDate)` that calls `search.messages` and returns channel IDs with new activity
- New utility function `pLimit(concurrency)` — concurrency limiter, either in a shared util or inline in the ingestion service

## What Does NOT Change

- `SlackService.getMessagesSince()` — same API, same cursor logic
- `SlackService.getThreadReplies()` / `getFullThread()` — unchanged
- Rate limiting / throttle logic in `SlackService` — unchanged
- `onIngestComplete` callback and channel event firing — unchanged
- Mempalace mining — unchanged
- Oracle channel events — unchanged
- State file format (`OracleState`) — unchanged
