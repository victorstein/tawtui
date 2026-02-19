import { Injectable } from '@nestjs/common';
import { homedir } from 'os';
import { join } from 'path';
import type {
  CalendarEvent,
  GetEventsOptions,
  AuthResult,
} from './calendar.types';

@Injectable()
export class CalendarService {
  private async execGog(args: string[]): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    try {
      const proc = Bun.spawn(['gog', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return { stdout, stderr, exitCode };
    } catch {
      return {
        stdout: '',
        stderr: 'gog binary not found',
        exitCode: 1,
      };
    }
  }

  async isInstalled(): Promise<boolean> {
    const result = await this.execGog(['--version']);
    return result.exitCode === 0;
  }

  async isAuthenticated(): Promise<boolean> {
    const result = await this.execGog(['auth', 'list', '--json']);
    if (result.exitCode !== 0) return false;

    try {
      const parsed = JSON.parse(result.stdout) as {
        accounts: { email: string }[];
      };
      return parsed.accounts.length > 0;
    } catch {
      return false;
    }
  }

  getCredentialsPath(): string {
    const home = homedir();
    if (process.platform === 'darwin') {
      return join(
        home,
        'Library',
        'Application Support',
        'gogcli',
        'credentials.json',
      );
    }
    return join(home, '.config', 'gogcli', 'credentials.json');
  }

  async hasCredentials(): Promise<boolean> {
    return Bun.file(this.getCredentialsPath()).exists();
  }

  async importCredentials(filePath: string): Promise<AuthResult> {
    const result = await this.execGog(['auth', 'credentials', filePath]);

    if (result.exitCode === 0) {
      return { success: true };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to import credentials',
    };
  }

  async startAuth(email: string): Promise<AuthResult> {
    const result = await this.execGog([
      'auth',
      'add',
      email,
      '--services',
      'calendar',
    ]);

    if (result.exitCode === 0) {
      return { success: true };
    }
    return { success: false, error: result.stderr || 'Authentication failed' };
  }

  private async getDefaultAccount(): Promise<string | null> {
    const result = await this.execGog(['auth', 'list', '--json']);
    if (result.exitCode !== 0) return null;

    try {
      const parsed = JSON.parse(result.stdout) as {
        accounts: { email: string }[];
      };
      return parsed.accounts[0]?.email ?? null;
    } catch {
      return null;
    }
  }

  async getEvents(options: GetEventsOptions): Promise<CalendarEvent[]> {
    const calendarId = options.calendarId ?? 'primary';
    const account = options.account ?? (await this.getDefaultAccount());

    if (!account) {
      throw new Error(
        'No Google account configured. Run: gog auth add you@gmail.com',
      );
    }

    const result = await this.execGog([
      'calendar',
      'events',
      calendarId,
      '--account',
      account,
      '--from',
      options.from,
      '--to',
      options.to,
      '--json',
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get events for calendar ${calendarId}: ${result.stderr}`,
      );
    }

    try {
      const parsed = JSON.parse(result.stdout) as { events: CalendarEvent[] };
      return parsed.events ?? [];
    } catch {
      throw new Error(
        `Failed to parse events response for calendar ${calendarId}: ${result.stdout}`,
      );
    }
  }
}
