// src/modules/notification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { NotificationPayload } from './notification.types';
import { TERMINAL_BUNDLE_IDS, DEFAULT_BUNDLE_ID } from './notification.types';

const NOTIFY_APP_REL_PATH = 'TaWTUI Notify.app/Contents/MacOS/tawtui-notify';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private terminalBundleId: string;
  private installedCache: boolean | null = null;
  private readonly binaryPath: string;

  constructor() {
    this.terminalBundleId = this.detectTerminalBundleId();
    this.binaryPath = this.resolveHelperPath();
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    const installed = await this.isInstalled();
    if (!installed) {
      this.logger.debug('Notification helper not found, skipping notification');
      return false;
    }

    const args = this.buildArgs(payload);
    return this.exec(args);
  }

  async isInstalled(): Promise<boolean> {
    if (this.installedCache !== null) return this.installedCache;

    try {
      const proc = Bun.spawn([this.binaryPath, '-help'], {
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

  private resolveHelperPath(): string {
    const candidates = [
      // Development: __dirname is src/modules/, helper is in dist/
      resolve(__dirname, '..', '..', 'dist', NOTIFY_APP_REL_PATH),
      // Compiled binary: __dirname is the binary's directory (e.g. dist/)
      resolve(__dirname, NOTIFY_APP_REL_PATH),
      // Homebrew: binary in bin/, helper in libexec/
      resolve(__dirname, '..', 'libexec', NOTIFY_APP_REL_PATH),
    ];
    return candidates.find((p) => existsSync(p)) ?? candidates[0];
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
      const proc = Bun.spawn([this.binaryPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stderr, exitCode] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.debug(
          `Notification helper failed (exit ${exitCode}): ${stderr}`,
        );
        return false;
      }

      return true;
    } catch {
      this.logger.debug('Notification helper exec failed');
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
