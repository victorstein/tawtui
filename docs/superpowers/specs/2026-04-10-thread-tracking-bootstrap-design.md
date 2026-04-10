# Thread Tracking Bootstrap

## Problem

`trackedThreads` starts empty because all existing messages were ingested before the tracking code was added. Phase 2 has nothing to re-check, so thread replies posted after the cursor advanced are never fetched.

## Solution

One-time backfill: at the start of Phase 2, if a channel has a cursor but no `trackedThreads` entries, look back 7 days from the current cursor to find recent thread parents and seed `trackedThreads`. Normal Phase 2 re-check then runs immediately for the seeded threads.

## Design

At the start of Phase 2 in `ingest()`, before iterating tracked threads, for each channel in `filteredConversations`:

1. Check if channel has a cursor (`state.channelCursors[id]` exists) but no `trackedThreads` entries
2. If so, compute `backfillCursor = cursor - 7 days`
3. Call `getMessagesSince(channelId, backfillCursor)` to scan recent history
4. For each message with `replyCount > 0`, add to `trackedThreads` with `lastReplyTs = message.ts` (conservative — forces Phase 2 to fetch all replies)
5. Save state

This runs once per channel. After seeding, `trackedThreads` has entries and the backfill condition is false on subsequent syncs.

### Files to Change

| File | Change |
|---|---|
| `src/modules/slack/slack-ingestion.service.ts` | Add backfill block at start of Phase 2 |
| `test/slack-ingestion.service.spec.ts` | Test backfill seeds trackedThreads, only runs once |

### No Other Changes

No type changes, no API changes, no UI changes.
