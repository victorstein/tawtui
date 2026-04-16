import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import type { OracleState, SlackConversation } from './slack.types';
import { OracleEventService } from '../oracle/oracle-event.service';
import { pLimit } from '../../shared/plimit';

const INITIAL_LOOKBACK_MS = 15 * 24 * 60 * 60 * 1000; // 15 days
const INITIAL_LOOKBACK_S = 15 * 24 * 60 * 60; // 15 days in seconds
const THREAD_RESCAN_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h window to catch messages that gained threads after initial fetch

@Injectable()
export class SlackIngestionService {
  private readonly logger = new Logger(SlackIngestionService.name);
  private readonly stagingDir = join(
    homedir(),
    '.local',
    'share',
    'tawtui',
    'slack-inbox',
  );
  private readonly statePath = join(
    homedir(),
    '.config',
    'tawtui',
    'oracle-state.json',
  );

  private _ingesting = false;
  private _generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  onStatusChange: ((ingesting: boolean) => void) | null = null;
  onIngestComplete:
    | ((result: { messagesStored: number; channelNames: string[] }) => void)
    | null = null;
  /** One-time callback fired after the first successful ingest. Cleared after firing. */
  onFirstIngestComplete: (() => void) | null = null;
  oracleEventService: OracleEventService | null = null;
  /** The authenticated user's Slack ID — used to detect self-DM channel */
  slackUserId: string | null = null;
  /** Cached self-DM channel ID (detected from conversations list) */
  private selfDmChannelId: string | null = null;

  get ingesting(): boolean {
    return this._ingesting;
  }

  /** Whether at least one successful ingestion has completed (lastChecked is set). */
  get hasCompletedSync(): boolean {
    const state = this.loadState();
    return !!state.lastChecked;
  }

  constructor(
    private readonly slackService: SlackService,
    private readonly mempalaceService: MempalaceService,
  ) {}

  /** Run one full ingestion cycle: fetch → write files → mine → update state */
  async ingest(
    onProgress?: (info: {
      phase:
        | 'listing'
        | 'channel'
        | 'waiting'
        | 'skipped'
        | 'detecting'
        | 'threads'
        | 'prefilter'
        | 'fetching'
        | 'mining';
      channel?: string;
      messageCount?: number;
      channelIndex?: number;
      totalChannels?: number;
      channelsSoFar?: number;
      page?: number;
      waitMs?: number;
      waitReason?: 'throttle' | 'rate-limited';
    }) => void,
    options?: { skipExisting?: boolean },
  ): Promise<{ messagesStored: number; channelNames: string[] }> {
    if (this._ingesting) return { messagesStored: 0, channelNames: [] };

    this._ingesting = true;
    const gen = this._generation;
    this.onStatusChange?.(true);

    const prevOnWait = this.slackService.onWait;
    const prevShouldAbort = this.slackService.shouldAbort;
    try {
      // Set abort check so rate-limit waits are cut short on cancel
      this.slackService.shouldAbort = () => this._generation !== gen;

      // Hook up rate-limit feedback to progress, with current channel context
      let waitCtx: {
        channel?: string;
        channelIndex?: number;
        totalChannels?: number;
        channelsSoFar?: number;
      } = {};
      if (onProgress) {
        this.slackService.onWait = (info) => {
          onProgress({
            phase: 'waiting',
            waitMs: info.waitMs,
            waitReason: info.reason,
            ...waitCtx,
          });
        };
      }

      const state = this.loadState();

      // Hydrate user name cache from persisted state
      if (state.userNames) {
        this.slackService.hydrateUserCache(state.userNames);
      }

      let conversations: SlackConversation[];
      if (state.conversations?.length) {
        // Use cached channel list (only missing after reset or first run)
        conversations = state.conversations;
      } else {
        // Cache missing or stale: fetch fresh
        onProgress?.({ phase: 'listing' });
        conversations = await this.slackService.getConversations(
          (info) => {
            waitCtx = { channelsSoFar: info.channelsSoFar };
            onProgress?.({
              phase: 'listing',
              channelsSoFar: info.channelsSoFar,
              page: info.page,
            });
          },
          () => this._generation !== gen,
        );
        if (this._generation !== gen)
          return { messagesStored: 0, channelNames: [] };
        state.conversations = conversations;
        state.channelsCachedAt = new Date().toISOString();
        this.saveState(state);
      }
      if (this._generation !== gen)
        return { messagesStored: 0, channelNames: [] };

      // Detect active channels — refresh hourly so new channels are picked up
      const ACTIVE_CHANNELS_TTL_MS = 60 * 60 * 1000; // 1 hour
      const activeAge = state.activeChannelsCachedAt
        ? Date.now() - new Date(state.activeChannelsCachedAt).getTime()
        : Infinity;
      const activeStale = activeAge >= ACTIVE_CHANNELS_TTL_MS;

      let activeChannelIds: Set<string>;
      if (state.activeChannelIds?.length && !activeStale) {
        activeChannelIds = new Set(state.activeChannelIds);
      } else {
        const afterDate = new Date(Date.now() - INITIAL_LOOKBACK_MS)
          .toISOString()
          .split('T')[0];
        activeChannelIds = await this.slackService.getActiveChannelIds(
          afterDate,
          (info) => {
            onProgress?.({
              phase: 'detecting',
              channelsSoFar: info.matchesSoFar,
              page: info.page,
            });
          },
          () => this._generation !== gen,
        );
        if (this._generation !== gen)
          return { messagesStored: 0, channelNames: [] };

        // Also detect channels where the user was @mentioned
        try {
          const mentionedChannelIds =
            await this.slackService.getMentionedChannelIds(
              afterDate,
              (info) => {
                onProgress?.({
                  phase: 'detecting',
                  channelsSoFar: activeChannelIds.size + info.matchesSoFar,
                  page: info.page,
                });
              },
              () => this._generation !== gen,
            );
          if (this._generation !== gen)
            return { messagesStored: 0, channelNames: [] };
          for (const id of mentionedChannelIds) {
            activeChannelIds.add(id);
          }
        } catch (err) {
          this.logger.warn(
            `Mention detection failed, continuing with active-only: ${(err as Error).message}`,
          );
        }

        state.activeChannelIds = [...activeChannelIds];
        state.activeChannelsCachedAt = new Date().toISOString();
        this.saveState(state);
      }
      if (this._generation !== gen)
        return { messagesStored: 0, channelNames: [] };

      // Force-include self-DM channel (search.messages doesn't index self-messages)
      if (this.selfDmChannelId) {
        activeChannelIds.add(this.selfDmChannelId);
      } else if (this.slackUserId) {
        // Find the self-DM: an im channel whose name matches the user's own ID
        const selfDm = conversations.find(
          (c) => c.isDm && c.name === this.slackUserId,
        );
        if (selfDm) {
          this.selfDmChannelId = selfDm.id;
          activeChannelIds.add(selfDm.id);
        }
      }

      // Filter: channels the user is active in (posted or @mentioned)
      const filteredConversations = conversations.filter((c) =>
        activeChannelIds.has(c.id),
      );

      // Pre-filter: detect which channels have new messages via search
      let changedChannelIds: Set<string> | null = null;
      if (!options?.skipExisting) {
        // Only pre-filter on regular syncs, not initial setup
        const lastCheckedTs = state.lastChecked
          ? new Date(state.lastChecked).getTime()
          : null;
        if (lastCheckedTs) {
          onProgress?.({ phase: 'prefilter' });
          // Subtract 1 day: Slack's after: filter is date-based and exclusive
          // (after:2026-04-11 means April 12+), so we go back a day
          const searchDate = new Date(lastCheckedTs - 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];
          try {
            changedChannelIds = await this.slackService.getChangedChannelIds(
              searchDate,
              (info) => {
                onProgress?.({
                  phase: 'prefilter',
                  channelsSoFar: info.matchesSoFar,
                  page: info.page,
                });
              },
              () => this._generation !== gen,
            );
            if (this._generation !== gen)
              return { messagesStored: 0, channelNames: [] };

            // Force-include self-DM (search.messages doesn't index self-messages)
            if (this.selfDmChannelId) {
              changedChannelIds.add(this.selfDmChannelId);
            }
          } catch {
            // Search failed — fall back to checking all channels
            changedChannelIds = null;
          }
        }
      }

      let messagesStored = 0;
      let filesWritten = 0;
      const touchedChannelNames: Set<string> = new Set();

      mkdirSync(this.stagingDir, { recursive: true });

      // Phase 1: Fetch new messages per channel (concurrent, limit 3)
      const limit = pLimit(3);
      const channelsToFetch = filteredConversations.filter((conversation) => {
        if (options?.skipExisting && state.channelCursors[conversation.id]) {
          return false;
        }
        if (changedChannelIds && !changedChannelIds.has(conversation.id)) {
          return false;
        }
        return true;
      });

      if (channelsToFetch.length > 0) {
        onProgress?.({
          phase: 'fetching',
          totalChannels: channelsToFetch.length,
        });
      }

      const phase1Tasks = channelsToFetch.map((conversation) =>
        limit(async () => {
          if (this._generation !== gen) return;

          // Update waitCtx for rate-limit progress context
          const channelIdx = channelsToFetch.indexOf(conversation) + 1;
          waitCtx = {
            channel: conversation.name,
            channelIndex: channelIdx,
            totalChannels: channelsToFetch.length,
          };
          onProgress?.({
            phase: 'channel',
            channel: conversation.name,
            channelIndex: channelIdx,
            totalChannels: channelsToFetch.length,
          });

          const defaultCursor = String(
            (Date.now() - INITIAL_LOOKBACK_MS) / 1000,
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
              (info) => {
                onProgress?.({
                  phase: 'channel',
                  channel: conversation.name,
                  channelIndex: channelIdx,
                  totalChannels: channelsToFetch.length,
                  messageCount: info.messagesSoFar,
                  page: info.page,
                });
              },
            );
          } catch (err) {
            this.logger.warn(
              `Skipping channel ${conversation.id}: ${(err as Error).message}`,
            );
            return;
          }

          // Update trackedThreads from freshly-fetched messages
          if (!state.trackedThreads) state.trackedThreads = {};
          if (!state.trackedThreads[conversation.id])
            state.trackedThreads[conversation.id] = [];
          const channelThreads = state.trackedThreads[conversation.id];
          for (const msg of rawMessages) {
            if (msg.replyCount && msg.replyCount > 0) {
              const replies = rawMessages.filter((m) => m.threadTs === msg.ts);
              const lastReply =
                replies.length > 0 ? replies[replies.length - 1] : undefined;
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

          // Thread discovery rescan: re-fetch the last 48h to catch messages
          // that had replyCount=0 when first synced but have since gained replies.
          // Only runs for previously-synced channels (cursor exists).
          if (state.channelCursors[conversation.id]) {
            const rescanCursor = String(
              (Date.now() - THREAD_RESCAN_WINDOW_MS) / 1000,
            );
            let rescanMessages: typeof rawMessages;
            if (parseFloat(cursor) <= parseFloat(rescanCursor)) {
              // Phase 1 fetch already covers this window — reuse rawMessages
              rescanMessages = rawMessages.filter(
                (m) => parseFloat(m.ts) >= parseFloat(rescanCursor),
              );
            } else {
              // Cursor is within 48h — fetch the gap between rescan start and cursor
              try {
                rescanMessages = await this.slackService.getMessagesSince(
                  conversation.id,
                  rescanCursor,
                );
              } catch {
                rescanMessages = [];
              }
            }
            for (const msg of rescanMessages) {
              if (!msg.replyCount || msg.replyCount === 0) continue;
              if (msg.threadTs && msg.threadTs !== msg.ts) continue;
              if (!channelThreads.some((t) => t.threadTs === msg.ts)) {
                channelThreads.push({
                  threadTs: msg.ts,
                  lastReplyTs: msg.ts,
                });
              }
            }
          }

          if (rawMessages.length === 0) return;

          const channelLabel = conversation.isDm
            ? await this.slackService.resolveUserName(conversation.name)
            : conversation.name;

          const slackExport: Array<Record<string, string>> = [];
          for (const raw of rawMessages) {
            const userName = await this.slackService.resolveUserName(
              raw.userId,
            );
            const isReply = !!raw.threadTs && raw.threadTs !== raw.ts;
            slackExport.push({
              type: 'message',
              user: userName,
              text: this.formatMessageText(
                userName,
                raw.text,
                raw.ts,
                channelLabel,
                conversation.isDm,
                isReply,
              ),
              ts: raw.ts,
            });
          }

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

          onProgress?.({
            phase: 'channel',
            channel: conversation.name,
            messageCount: rawMessages.length,
            channelIndex: channelIdx,
            totalChannels: channelsToFetch.length,
          });

          const lastTopLevel = rawMessages.filter((m) => !m.threadTs).pop();
          const lastTs =
            lastTopLevel?.ts ?? rawMessages[rawMessages.length - 1].ts;
          state.channelCursors[conversation.id] = lastTs;
        }),
      );

      await Promise.allSettled(phase1Tasks);

      // Save state after Phase 1 completes
      if (messagesStored > 0) {
        state.userNames = this.slackService.exportUserCache();
        state.lastChecked = new Date().toISOString();
        this.saveState(state);
      }

      // Phase 2: Re-check tracked threads for new replies (concurrent, limit 3)
      if (!state.trackedThreads) state.trackedThreads = {};
      const pruneThreshold = String((Date.now() - INITIAL_LOOKBACK_MS) / 1000);

      const phase2Tasks: Array<Promise<void>> = [];

      onProgress?.({ phase: 'threads' });

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
          onProgress?.({
            phase: 'threads',
            channel: conversation.name,
          });
          const backfillCursor = String(
            parseFloat(channelCursor) - INITIAL_LOOKBACK_S,
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

        // Prune threads older than 30 days
        state.trackedThreads[conversation.id] = threads.filter(
          (t) => t.threadTs > pruneThreshold,
        );

        const activeThreads = state.trackedThreads[conversation.id];

        onProgress?.({
          phase: 'threads',
          channel: conversation.name,
          messageCount: activeThreads.length,
        });

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

              const channelLabel = conversation.isDm
                ? await this.slackService.resolveUserName(conversation.name)
                : conversation.name;

              const slackExport: Array<Record<string, string>> = [];
              for (let i = 0; i < fullThread.length; i++) {
                const msg = fullThread[i];
                const userName = await this.slackService.resolveUserName(
                  msg.userId,
                );
                const isReply = i > 0;
                slackExport.push({
                  type: 'message',
                  user: userName,
                  text: this.formatMessageText(
                    userName,
                    msg.text,
                    msg.ts,
                    channelLabel,
                    conversation.isDm,
                    isReply,
                  ),
                  ts: msg.ts,
                });
              }

              const channelSlug = this.slugify(
                conversation.name,
                conversation.isDm,
              );
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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

      // Prune cursors and tracked threads for channels no longer active
      for (const channelId of Object.keys(state.channelCursors)) {
        if (!activeChannelIds.has(channelId)) {
          delete state.channelCursors[channelId];
          if (state.trackedThreads?.[channelId]) {
            delete state.trackedThreads[channelId];
          }
        }
      }

      // Save state after Phase 2 completes
      this.saveState(state);

      // Mine all new files into mempalace (idempotent — skips already-mined)
      if (filesWritten > 0) {
        onProgress?.({ phase: 'mining' });
        try {
          await this.mempalaceService.mine(this.stagingDir, 'slack');
        } catch (err) {
          this.logger.warn(
            `Mining failed (messages still staged): ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Ingestion complete: ${messagesStored} messages in ${filesWritten} files`,
      );
      return { messagesStored, channelNames: [...touchedChannelNames] };
    } finally {
      this.slackService.onWait = prevOnWait;
      this.slackService.shouldAbort = prevShouldAbort;
      if (this._generation === gen) {
        this._ingesting = false;
        this.onStatusChange?.(false);
      }
    }
  }

  async triggerIngest(
    onProgress?: Parameters<typeof this.ingest>[0],
  ): Promise<{ messagesStored: number; channelNames: string[] }> {
    const result = await this.ingest(onProgress);

    // Fire sync-complete event to oracle channel (same as safeIngest)
    if (result.messagesStored > 0 && this.oracleEventService) {
      const rejectedTasks = this.oracleEventService.readRejectedTasks();
      void this.oracleEventService.postEvent({
        type: 'sync-complete',
        messagesStored: result.messagesStored,
        channels: result.channelNames,
        rejectedTasks,
      });
    }

    return result;
  }

  /** Start periodic ingestion (called by TuiService on launch) */
  startPolling(intervalMs: number): void {
    if (this.timer) return;
    this.logger.log(`Starting ingestion polling every ${intervalMs / 1000}s`);
    this.timer = setInterval(() => void this.safeIngest(), intervalMs);
  }

  /** Stop periodic ingestion (called on TUI exit) */
  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Ingestion polling stopped');
    }
  }

  /** Stop polling and abort any in-flight ingestion so a fresh one can start. */
  resetState(): void {
    this.stopPolling();
    this._generation++;
    this._ingesting = false;
    this.onStatusChange?.(false);

    // Preserve conversation/active-channel caches across reset
    const prev = this.loadState();
    rmSync(this.statePath, { force: true });
    rmSync(this.stagingDir, { recursive: true, force: true });

    if (prev.conversations?.length || prev.activeChannelIds?.length) {
      this.saveState({
        lastChecked: null,
        channelCursors: {},
        conversations: prev.conversations,
        activeChannelIds: prev.activeChannelIds,
        channelsCachedAt: prev.channelsCachedAt,
        activeChannelsCachedAt: prev.activeChannelsCachedAt,
      });
    }

    this.logger.log('Ingestion state reset');
  }

  /** Abort any in-flight ingestion without resetting state. */
  abort(): void {
    this._generation++;
    this._ingesting = false;
    this.onStatusChange?.(false);
  }

  /** Whether the polling timer is active */
  isPolling(): boolean {
    return this.timer !== null;
  }

  private async safeIngest(): Promise<void> {
    if (this._ingesting) return; // Skip if a manual sync is already running
    try {
      const result = await this.ingest();
      this.onIngestComplete?.(result);

      if (result.messagesStored > 0 && this.onFirstIngestComplete) {
        this.onFirstIngestComplete();
        this.onFirstIngestComplete = null;
      }

      // Fire sync-complete event to oracle channel (only if new messages)
      if (result.messagesStored > 0 && this.oracleEventService) {
        const rejectedTasks = this.oracleEventService.readRejectedTasks();
        void this.oracleEventService.postEvent({
          type: 'sync-complete',
          messagesStored: result.messagesStored,
          channels: result.channelNames,
          rejectedTasks,
        });
      }
    } catch (err) {
      this.logger.error(`Ingestion failed: ${(err as Error).message}`);
    }
  }

  private slugify(name: string, isDm: boolean): string {
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return isDm ? `dm-${slug}` : slug;
  }

  private formatMessageText(
    userName: string,
    text: string,
    ts: string,
    channelName: string,
    isDm: boolean,
    isThreadReply: boolean,
  ): string {
    const date = new Date(parseFloat(ts) * 1000);
    const dateStr = date.toISOString().replace('T', ' ').slice(0, 16);
    const channelLabel = isDm ? `DM:${channelName}` : `#${channelName}`;
    const threadLabel = isThreadReply ? ' | thread' : '';
    return `[${dateStr} | ${channelLabel}${threadLabel}] ${userName}: ${text}`;
  }

  private loadState(): OracleState {
    if (!existsSync(this.statePath)) {
      return { lastChecked: null, channelCursors: {} };
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.statePath, 'utf-8'));
      // Validate channelCursors is a plain object (not string, array, null, etc.)
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('channelCursors' in raw) ||
        typeof (raw as OracleState).channelCursors !== 'object' ||
        (raw as OracleState).channelCursors === null ||
        Array.isArray((raw as OracleState).channelCursors)
      ) {
        return { lastChecked: null, channelCursors: {} };
      }
      return raw as OracleState;
    } catch {
      return { lastChecked: null, channelCursors: {} };
    }
  }

  private saveState(state: OracleState): void {
    const dir = join(homedir(), '.config', 'tawtui');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}
