import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import type { OracleState, SlackConversation } from './slack.types';
import { OracleEventService } from '../oracle/oracle-event.service';


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
  onIngestComplete: ((result: { messagesStored: number; channelNames: string[] }) => void) | null = null;
  oracleEventService: OracleEventService | null = null;

  get ingesting(): boolean {
    return this._ingesting;
  }

  constructor(
    private readonly slackService: SlackService,
    private readonly mempalaceService: MempalaceService,
  ) {}

  /** Run one full ingestion cycle: fetch → write files → mine → update state */
  async ingest(
    onProgress?: (info: {
      phase: 'listing' | 'channel' | 'waiting' | 'skipped' | 'detecting' | 'threads';
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
        if (this._generation !== gen) return { messagesStored: 0, channelNames: [] };
        state.conversations = conversations;
        state.channelsCachedAt = new Date().toISOString();
        this.saveState(state);
      }
      if (this._generation !== gen) return { messagesStored: 0, channelNames: [] };

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
        const afterDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
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
        if (this._generation !== gen) return { messagesStored: 0, channelNames: [] };
        state.activeChannelIds = [...activeChannelIds];
        state.activeChannelsCachedAt = new Date().toISOString();
        this.saveState(state);
      }
      if (this._generation !== gen) return { messagesStored: 0, channelNames: [] };

      // Filter: channels the user is active in + channels we've previously synced
      const filteredConversations = conversations.filter(
        (c) => activeChannelIds.has(c.id) || state.channelCursors[c.id],
      );

      let messagesStored = 0;
      let filesWritten = 0;
      const touchedChannelNames: Set<string> = new Set();
      const totalChannels = filteredConversations.length;

      mkdirSync(this.stagingDir, { recursive: true });

      for (let i = 0; i < filteredConversations.length; i++) {
        if (this._generation !== gen) return { messagesStored, channelNames: [...touchedChannelNames] };
        const conversation = filteredConversations[i];
        const channelIndex = i + 1;
        waitCtx = { channel: conversation.name, channelIndex, totalChannels };
        // Skip channels already processed when resuming
        const existingCursor = state.channelCursors[conversation.id];
        if (options?.skipExisting && existingCursor) {
          onProgress?.({
            phase: 'skipped',
            channel: conversation.name,
            channelIndex,
            totalChannels,
          });
          continue;
        }

        // Default cursor: 7 days ago (avoids fetching entire channel history on first run)
        const defaultCursor = String(
          (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000,
        );
        const cursor = existingCursor ?? defaultCursor;

        onProgress?.({
          phase: 'channel',
          channel: conversation.name,
          messageCount: 0,
          channelIndex,
          totalChannels,
        });

        let rawMessages: Array<{ ts: string; userId: string; text: string; threadTs?: string; replyCount?: number }>;
        try {
          rawMessages = await this.slackService.getMessagesSince(
            conversation.id,
            cursor,
          );
        } catch (err) {
          this.logger.warn(
            `Skipping channel ${conversation.id}: ${(err as Error).message}`,
          );
          continue;
        }

        onProgress?.({
          phase: 'channel',
          channel: conversation.name,
          messageCount: rawMessages.length,
          channelIndex,
          totalChannels,
        });

        if (rawMessages.length === 0) continue;

        // Resolve usernames for all messages
        const slackExport: Array<Record<string, string>> = [];
        for (const raw of rawMessages) {
          const userName = await this.slackService.resolveUserName(raw.userId);
          slackExport.push({
            type: 'message',
            user: userName,
            text: `${userName}: ${raw.text}`,
            ts: raw.ts,
          });
        }

        // Write one file per channel per cycle (never modified → mine dedup works)
        const channelSlug = this.slugify(conversation.name, conversation.isDm);
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
      }

      // Phase 2: Re-check tracked threads for new replies
      if (!state.trackedThreads) state.trackedThreads = {};
      const sevenDaysAgo = String((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

      for (const conversation of filteredConversations) {
        if (this._generation !== gen) return { messagesStored, channelNames: [...touchedChannelNames] };

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
            messageCount: 0,
          });
          const backfillCursor = String(
            parseFloat(channelCursor) - 7 * 24 * 60 * 60,
          );
          try {
            const backfillMessages =
              await this.slackService.getMessagesSince(
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
              onProgress?.({
                phase: 'threads',
                channel: conversation.name,
                messageCount: threadParents.length,
              });
              this.saveState(state);
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
        onProgress?.({
          phase: 'threads',
          channel: conversation.name,
          messageCount: activeThreads.length,
        });

        for (const tracked of activeThreads) {
          if (this._generation !== gen) return { messagesStored, channelNames: [...touchedChannelNames] };

          let replies: Array<{ ts: string; userId: string; text: string }>;
          try {
            replies = await this.slackService.getThreadReplies(
              conversation.id,
              tracked.threadTs,
            );
          } catch {
            continue;
          }

          // Check if there are new replies since last sync
          const newReplies = replies.filter((r) => r.ts > tracked.lastReplyTs);
          if (newReplies.length === 0) continue;

          // Fetch full thread (parent + all replies) so mempalace gets the complete conversation
          let fullThread: Array<{ ts: string; userId: string; text: string }>;
          try {
            fullThread = await this.slackService.getFullThread(
              conversation.id,
              tracked.threadTs,
            );
          } catch {
            continue;
          }

          // Resolve usernames and write full thread to staging
          const slackExport: Array<Record<string, string>> = [];
          for (const msg of fullThread) {
            const userName = await this.slackService.resolveUserName(msg.userId);
            slackExport.push({
              type: 'message',
              user: userName,
              text: `${userName}: ${msg.text}`,
              ts: msg.ts,
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
          touchedChannelNames.add(conversation.name);
          tracked.lastReplyTs = newReplies[newReplies.length - 1].ts;
        }

          this.saveState(state);
        }

      // Mine all new files into mempalace (idempotent — skips already-mined)
      if (filesWritten > 0) {
        await this.mempalaceService.mine(this.stagingDir, 'slack');
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
    return this.ingest(onProgress);
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

  private slugify(name: string, isDm: boolean): string {
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return isDm ? `dm-${slug}` : slug;
  }

  private loadState(): OracleState {
    if (!existsSync(this.statePath)) {
      return { lastChecked: null, channelCursors: {} };
    }
    try {
      return JSON.parse(readFileSync(this.statePath, 'utf-8')) as OracleState;
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
