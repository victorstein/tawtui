import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  CalendarEvent,
  GetEventsOptions,
  AuthResult,
  ManualAuthSession,
} from './calendar.types';

const BUNDLED_CREDENTIALS_PATH = path.join(
  import.meta.dir,
  '..',
  'assets',
  'google',
  'credentials.json',
);

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

  async hasCredentials(): Promise<boolean> {
    const result = await this.execGog(['config', 'path']);
    if (result.exitCode !== 0) return false;

    const configDir = path.dirname(result.stdout.trim());
    return existsSync(path.join(configDir, 'credentials.json'));
  }

  async ensureCredentials(): Promise<{ success: boolean; error?: string }> {
    if (await this.hasCredentials()) {
      return { success: true };
    }

    const result = await this.execGog([
      'auth',
      'credentials',
      BUNDLED_CREDENTIALS_PATH,
    ]);

    if (result.exitCode === 0) {
      return { success: true };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to import credentials',
    };
  }

  async startAuth(email: string): Promise<AuthResult> {
    const credResult = await this.ensureCredentials();
    if (!credResult.success) {
      return {
        success: false,
        error: credResult.error ?? 'Failed to configure credentials',
      };
    }

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

  async startAuthManual(
    email: string,
  ): Promise<ManualAuthSession | AuthResult> {
    const credResult = await this.ensureCredentials();
    if (!credResult.success) {
      return {
        success: false,
        error: credResult.error ?? 'Failed to configure credentials',
      };
    }

    let proc: {
      stdin: import('bun').FileSink;
      stdout: ReadableStream<Uint8Array>;
      stderr: ReadableStream<Uint8Array>;
      exited: Promise<number>;
      kill: () => void;
    };
    try {
      const spawned = Bun.spawn(
        ['gog', 'auth', 'add', email, '--manual', '--services', 'calendar'],
        {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      proc = {
        stdin: spawned.stdin,
        stdout: spawned.stdout as ReadableStream<Uint8Array>,
        stderr: spawned.stderr as ReadableStream<Uint8Array>,
        exited: spawned.exited,
        kill: () => spawned.kill(),
      };
    } catch {
      return { success: false, error: 'gog binary not found' };
    }

    // gog outputs the OAuth URL to stderr, not stdout
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let output = '';
    const timeout = 10_000;
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < timeout) {
        const remaining = timeout - (Date.now() - startTime);
        const result = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(
              () => resolve({ value: undefined, done: true }),
              remaining,
            ),
          ),
        ]);

        if (result.done && !result.value) break;
        if (result.value) {
          output += decoder.decode(result.value, { stream: true });
        }

        const urlMatch = output.match(/(https:\/\/accounts\.google\.com\S+)/);
        if (urlMatch) {
          reader.releaseLock();
          const authUrl = urlMatch[1];

          return {
            authUrl,
            complete: async (redirectUrl: string): Promise<AuthResult> => {
              try {
                void proc.stdin.write(redirectUrl + '\n');
                void proc.stdin.end();

                // stderr is already consumed by the URL reader, use stdout for any output
                const [stdout, exitCode] = await Promise.all([
                  new Response(proc.stdout).text(),
                  proc.exited,
                ]);

                if (exitCode === 0) {
                  return { success: true };
                }
                return {
                  success: false,
                  error: stdout || 'Authentication failed',
                };
              } catch {
                proc.kill();
                return {
                  success: false,
                  error: 'Failed to complete authentication',
                };
              }
            },
          };
        }

        if (result.done) break;
      }
    } catch {
      // Stream read error — fall through to error handling
    }

    // No URL found — process either timed out or exited early
    reader.releaseLock();
    proc.kill();
    await proc.exited;

    return {
      success: false,
      error: output || 'Failed to get OAuth URL from gog (timed out)',
    };
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
