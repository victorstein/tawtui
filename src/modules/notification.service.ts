// src/modules/notification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import type { NotificationPayload } from './notification.types';
import { TERMINAL_BUNDLE_IDS, DEFAULT_BUNDLE_ID } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private terminalBundleId: string;
  private installedCache: boolean | null = null;

  constructor() {
    this.terminalBundleId = this.detectTerminalBundleId();
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    const installed = await this.isInstalled();
    if (!installed) {
      this.logger.debug(
        'terminal-notifier not installed, skipping notification',
      );
      return false;
    }

    const args = this.buildArgs(payload);
    return this.exec(args);
  }

  async isInstalled(): Promise<boolean> {
    if (this.installedCache !== null) return this.installedCache;

    try {
      const proc = Bun.spawn(['terminal-notifier', '-help'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      this.installedCache = exitCode === 0;
    } catch {
      this.installedCache = false;
    }

    return this.installedCache;
  }

  private buildArgs(payload: NotificationPayload): string[] {
    const args: string[] = [
      '-title',
      payload.title,
      '-message',
      payload.message,
      '-sound',
      'default',
      '-activate',
      this.terminalBundleId,
    ];

    if (payload.subtitle) {
      args.push('-subtitle', payload.subtitle);
    }

    if (payload.appIcon) {
      args.push('-appIcon', payload.appIcon);
    }

    return args;
  }

  private async exec(args: string[]): Promise<boolean> {
    try {
      const proc = Bun.spawn(['terminal-notifier', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stderr, exitCode] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.debug(
          `terminal-notifier failed (exit ${exitCode}): ${stderr}`,
        );
        return false;
      }

      return true;
    } catch {
      this.logger.debug('terminal-notifier exec failed');
      return false;
    }
  }

  private detectTerminalBundleId(): string {
    const termProgram = process.env.TERM_PROGRAM;

    if (!termProgram) {
      this.logger.warn(
        'TERM_PROGRAM not set, falling back to com.apple.Terminal for notification click actions',
      );
      return DEFAULT_BUNDLE_ID;
    }

    const bundleId = TERMINAL_BUNDLE_IDS[termProgram];

    if (!bundleId) {
      this.logger.warn(
        `Unknown terminal "${termProgram}", falling back to com.apple.Terminal for notification click actions`,
      );
      return DEFAULT_BUNDLE_ID;
    }

    return bundleId;
  }
}
