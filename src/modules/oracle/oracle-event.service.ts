import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class OracleEventService {
  private readonly logger = new Logger(OracleEventService.name);
  private readonly rejectedDir: string;

  constructor(private readonly workspaceDir: string) {
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
}
