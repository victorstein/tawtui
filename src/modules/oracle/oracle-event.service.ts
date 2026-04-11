import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ORACLE_CHANNEL_PORT,
  OracleChannelEvent,
} from './oracle-channel.types';

@Injectable()
export class OracleEventService {
  private readonly logger = new Logger(OracleEventService.name);
  private readonly rejectedDir: string;

  constructor(
    private readonly workspaceDir: string,
    private readonly backoffMs: number = 2000,
  ) {
    this.rejectedDir = join(workspaceDir, 'rejected');
  }

  /**
   * Read rejected task files from the rejected/ directory within a date window.
   * Returns concatenated contents of all files from sinceDate through today.
   */
  readRejectedTasks(sinceDate?: Date): string {
    if (!existsSync(this.rejectedDir)) return '';

    const since = sinceDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().split('T')[0];

    const files = readdirSync(this.rejectedDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => f.slice(0, 10) >= sinceStr)
      .sort();

    if (files.length === 0) return '';

    return files
      .map((f) => readFileSync(join(this.rejectedDir, f), 'utf-8'))
      .join('\n');
  }

  /**
   * POST an event to the oracle channel server. Fire-and-forget with retry.
   * Retries up to 3 times with backoff to handle startup race.
   */
  async postEvent(event: OracleChannelEvent): Promise<void> {
    const url = `http://127.0.0.1:${ORACLE_CHANNEL_PORT}`;
    const body = JSON.stringify(event);
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fetch(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        });
        return;
      } catch (err) {
        if (attempt < maxAttempts) {
          this.logger.warn(
            `Channel POST attempt ${attempt}/${maxAttempts} failed, retrying in ${this.backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, this.backoffMs));
        } else {
          this.logger.error(
            `Channel POST failed after ${maxAttempts} attempts: ${(err as Error).message}`,
          );
        }
      }
    }
  }
}
