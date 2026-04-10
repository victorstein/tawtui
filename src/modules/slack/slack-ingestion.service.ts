import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import type { OracleState, SlackConversation } from './slack.types';

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
      phase: 'listing' | 'channel' | 'waiting' | 'skipped' | 'detecting';
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
  ): Promise<{ messagesStored: number }> {
    if (this._ingesting) return { messagesStored: 0 };

    this._ingesting = true;
    const gen = this._generation;
    this.onStatusChange?.(true);

    const prevOnWait = this.slackService.onWait;
    try {
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
      if (options?.skipExisting && state.conversations?.length) {
        conversations = state.conversations;
        onProgress?.({
          phase: 'listing',
          channelsSoFar: conversations.length,
          page: 0,
        });
      } else {
        onProgress?.({ phase: 'listing' });
        conversations = await this.slackService.getConversations((info) => {
          waitCtx = { channelsSoFar: info.channelsSoFar };
          onProgress?.({
            phase: 'listing',
            channelsSoFar: info.channelsSoFar,
            page: info.page,
          });
        });
        state.conversations = conversations;
        this.saveState(state);
      }

      // Detect active channels (skip if cached during retry)
      let activeChannelIds: Set<string>;
      if (options?.skipExisting && state.activeChannelIds?.length) {
        activeChannelIds = new Set(state.activeChannelIds);
        onProgress?.({
          phase: 'detecting',
          channelsSoFar: activeChannelIds.size,
        });
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
        );
        state.activeChannelIds = [...activeChannelIds];
        this.saveState(state);
      }

      // Filter: all DMs/MPIMs + channels the user is active in
      const filteredConversations = conversations.filter(
        (c) => c.isDm || activeChannelIds.has(c.id),
      );

      let messagesStored = 0;
      let filesWritten = 0;
      const totalChannels = filteredConversations.length;

      mkdirSync(this.stagingDir, { recursive: true });

      for (let i = 0; i < filteredConversations.length; i++) {
        if (this._generation !== gen) return { messagesStored };
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

        let rawMessages: Array<{ ts: string; userId: string; text: string }>;
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

        // Advance cursor and persist immediately so progress survives app exit
        const lastTs = rawMessages[rawMessages.length - 1].ts;
        state.channelCursors[conversation.id] = lastTs;
        state.userNames = this.slackService.exportUserCache();
        state.lastChecked = new Date().toISOString();
        this.saveState(state);
      }

      // Mine all new files into mempalace (idempotent — skips already-mined)
      if (filesWritten > 0) {
        await this.mempalaceService.mine(this.stagingDir, 'slack');
      }

      this.logger.log(
        `Ingestion complete: ${messagesStored} messages in ${filesWritten} files`,
      );
      return { messagesStored };
    } finally {
      this.slackService.onWait = prevOnWait;
      if (this._generation === gen) {
        this._ingesting = false;
        this.onStatusChange?.(false);
      }
    }
  }

  async triggerIngest(): Promise<{ messagesStored: number }> {
    return this.ingest();
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

    rmSync(this.statePath, { force: true });
    rmSync(this.stagingDir, { recursive: true, force: true });

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
      await this.ingest();
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
