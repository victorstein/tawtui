import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import type { OracleState } from './slack.types';

@Injectable()
export class SlackIngestionService {
  private readonly logger = new Logger(SlackIngestionService.name);
  private readonly stagingDir = join(
    homedir(), '.local', 'share', 'tawtui', 'slack-inbox',
  );
  private readonly statePath = join(
    homedir(), '.config', 'tawtui', 'oracle-state.json',
  );

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly slackService: SlackService,
    private readonly mempalaceService: MempalaceService,
  ) {}

  /** Run one full ingestion cycle: fetch → write files → mine → update state */
  async ingest(): Promise<{ messagesStored: number }> {
    const state = this.loadState();
    const conversations = await this.slackService.getConversations();
    let messagesStored = 0;
    let filesWritten = 0;

    mkdirSync(this.stagingDir, { recursive: true });

    for (const conversation of conversations) {
      const cursor = state.channelCursors[conversation.id] ?? '0';

      let rawMessages: Array<{ ts: string; userId: string; text: string }>;
      try {
        rawMessages = await this.slackService.getMessagesSince(
          conversation.id, cursor,
        );
      } catch (err) {
        this.logger.warn(
          `Skipping channel ${conversation.id}: ${(err as Error).message}`,
        );
        continue;
      }

      if (rawMessages.length === 0) continue;

      // Resolve usernames for all messages
      const slackExport: Array<Record<string, string>> = [];
      for (const raw of rawMessages) {
        const userName = await this.slackService.resolveUserName(raw.userId);
        slackExport.push({
          type: 'message',
          user: userName,
          text: raw.text,
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

      // Advance cursor to newest processed message
      const lastTs = rawMessages[rawMessages.length - 1].ts;
      state.channelCursors[conversation.id] = lastTs;
    }

    // Mine all new files into mempalace (idempotent — skips already-mined)
    if (filesWritten > 0) {
      await this.mempalaceService.mine(this.stagingDir, 'slack');
    }

    state.lastChecked = new Date().toISOString();
    this.saveState(state);

    this.logger.log(
      `Ingestion complete: ${messagesStored} messages in ${filesWritten} files`,
    );
    return { messagesStored };
  }

  /** Start periodic ingestion (called by TuiService on launch) */
  startPolling(intervalMs: number): void {
    if (this.timer) return;
    this.logger.log(`Starting ingestion polling every ${intervalMs / 1000}s`);
    void this.safeIngest();
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
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
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
