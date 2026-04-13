# Slack Module

## Architecture Overview

```
TokenExtractorService → extracts xoxc/xoxd from Slack desktop app
SlackService          → API client with per-method rate limiting
SlackIngestionService → orchestrates the sync pipeline (5 phases)
MempalaceService      → CLI wrapper for mempalace mine/init/install
```

## Auth (xoxc/xoxd)

Tokens are extracted from the local Slack desktop app — NOT from an OAuth flow:
- **xoxc** (session token): read from LevelDB local storage (`localConfig_v2` key)
- **xoxd** (auth cookie): read from Cookies SQLite DB, decrypted via macOS Keychain (AES-128-CBC, Chromium format)
- Stored in config at `configService.getOracleConfig().slack`
- No refresh mechanism — re-extract if API returns 401

LevelDB extraction tries WAL `.log` files first (newest), falls back to SST `.ldb` files.

## Ingestion Pipeline (slack-ingestion.service.ts)

Five phases, abortable via `_generation` counter:

1. **List & Filter** — get conversations, detect active channels (search.messages from:me, 30-day window), identify self-DM
2. **Pre-filter** — `getChangedChannelIds()` skips unchanged channels since `lastChecked` (skipped on first sync)
3. **Fetch Messages** — concurrent (pLimit 3), cursor-based pagination, inline thread replies, write staging JSON files
4. **Sync Tracked Threads** — bootstrap new channels, prune threads >30 days old, fetch new replies for tracked threads
5. **Mine to Mempalace** — `mempalace mine <dir> --mode convos --wing slack` (idempotent, skips already-processed files)

## State File (`~/.config/tawtui/oracle-state.json`)

Key fields:
- `channelCursors: Record<channelId, ts>` — Slack message timestamp (Unix seconds with decimal). Next sync fetches messages strictly newer.
- `trackedThreads: Record<channelId, Array<{threadTs, lastReplyTs}>>` — active threads being monitored for new replies
- `activeChannelIds` + `activeChannelsCachedAt` — channels with user activity (30-day window), refreshed hourly (1hr TTL)
- `conversations` + `channelsCachedAt` — cached channel list
- `userNames: Record<userId, displayName>` — avoids redundant users.info calls

Cursor is updated to the last **top-level** message ts (excluding thread replies) to avoid skipping threaded conversations.

## Rate Limiting

Per-method throttle + 200ms global minimum gap:

| Method | Min Gap | Tier |
|---|---|---|
| conversations.list | 3000ms | Tier 2 |
| conversations.history | 1200ms | Tier 3 |
| conversations.replies | 1200ms | Tier 3 |
| users.info | 600ms | Tier 4 |
| search.messages | 3000ms | Tier 2 |

429 responses retry up to 3 times with `Retry-After` header. All waits are abortable (checked every 500ms).

## Staging Files (`~/.local/share/tawtui/slack-inbox/`)

- Format: `{ISO-timestamp}_{channel-slug}.json` or `{timestamp}_thread-{threadTs}_{channel-slug}.json`
- Content: JSON array of `{ type, user, text, ts }` — text is prefixed with `${userName}: `
- Files accumulate indefinitely (no cleanup). Mempalace deduplicates by source path.

## Gotchas

- **Self-DM channel**: Not indexed by `search.messages from:me`. Detected manually (im channel where `name === slackUserId`) and force-included in all filters.
- **Active channel TTL**: Refreshed every 60 min. Long-running sessions need this to pick up newly joined channels.
- **Pre-filter date math**: Subtracts 1 day from `lastChecked` because Slack's `after:` param is exclusive.
- **Cursor advancement**: Uses top-level message ts only. Thread reply ts is tracked separately in `trackedThreads`.
- **Thread bootstrap**: First sync of a channel seeds `trackedThreads` by backfilling 30 days and finding messages with `replyCount > 0`.
- **Thread pruning**: Threads older than 30 days are removed each sync to prevent unbounded growth.
