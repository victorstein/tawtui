import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from './config.service';
import type {
  HunkAvailability,
  LaunchForegroundParams,
} from './hunk-review.types';

// CONFIRMED `hunk session list --json` shape (hunk 0.16.0).
interface HunkSessionListItem {
  sessionId: string;
  cwd: string;
  sourceLabel?: string;
  inputKind?: string;
}
interface HunkSessionList {
  sessions: HunkSessionListItem[];
}

export interface ForegroundChild {
  exited: Promise<number>;
}
export interface ForegroundHooks {
  suspend: () => void;
  resume: () => void;
  spawn: (
    cmd: string[],
    opts: { cwd: string; stdio: 'inherit'; env: Record<string, string> },
  ) => ForegroundChild;
  reset: () => void;
}

@Injectable()
export class HunkService {
  private readonly logger = new Logger(HunkService.name);
  constructor(private readonly config: ConfigService) {}

  async isAvailable(): Promise<HunkAvailability> {
    const explicit = this.config.getHunkConfig().binaryPath;
    const candidates: string[][] = explicit
      ? [[explicit]]
      : [['hunk'], ['bunx', 'hunkdiff']];
    for (const command of candidates) {
      const res = await this.spawn([...command, '--version']);
      if (res.exitCode === 0) {
        return { available: true, command, detail: res.stdout.trim() };
      }
    }
    return {
      available: false,
      command: candidates[0],
      detail: 'hunk not found on PATH and `bunx hunkdiff` failed',
    };
  }

  async resolveSessionId(
    port: number,
    worktreePath?: string,
  ): Promise<string | null> {
    const command = await this.resolveCommand();
    // Scope the listing to this review's daemon via HUNK_MCP_PORT (sessions carry no port field).
    const res = await this.spawn([...command, 'session', 'list', '--json'], {
      HUNK_MCP_PORT: String(port),
    });
    if (res.exitCode !== 0) return null;
    let sessions: HunkSessionListItem[];
    try {
      sessions = (JSON.parse(res.stdout) as HunkSessionList).sessions ?? [];
    } catch {
      return null;
    }
    if (sessions.length === 0) return null;
    if (worktreePath) {
      return sessions.find((s) => s.cwd === worktreePath)?.sessionId ?? null;
    }
    return sessions[0].sessionId;
  }

  async launchForeground(
    params: LaunchForegroundParams,
    hooks: ForegroundHooks,
  ): Promise<void> {
    const command = await this.resolveCommand();
    const cmd = [
      ...command,
      'patch',
      params.patchPath,
      '--agent-context',
      params.agentContextPath,
      '--agent-notes',
      '--wrap',
    ];
    hooks.suspend();
    let exitCode = 0;
    try {
      // HUNK_MCP_PORT isolates this review's session daemon so concurrent reviews don't collide.
      const child = hooks.spawn(cmd, {
        cwd: params.worktreePath,
        stdio: 'inherit',
        env: { ...process.env, HUNK_MCP_PORT: String(params.port) } as Record<
          string,
          string
        >,
      });
      exitCode = await child.exited;
    } catch (err) {
      this.logger.warn(`hunk foreground launch failed: ${String(err)}`);
      exitCode = 1;
    } finally {
      if (exitCode !== 0) {
        hooks.reset();
      }
      hooks.resume();
    }
  }

  static defaultReset(): void {
    try {
      Bun.spawnSync(['sh', '-c', 'tput rmcup; tput sgr0; stty sane']);
    } catch {
      // best effort
    }
  }

  static defaultSpawn(
    cmd: string[],
    opts: { cwd: string; stdio: 'inherit'; env: Record<string, string> },
  ): ForegroundChild {
    return Bun.spawn(cmd, {
      cwd: opts.cwd,
      stdio: ['inherit', 'inherit', 'inherit'],
      env: opts.env,
    });
  }

  private async resolveCommand(): Promise<string[]> {
    return (await this.isAvailable()).command;
  }

  private async spawn(
    cmd: string[],
    env?: Record<string, string>,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const proc = Bun.spawn(cmd, {
        stdout: 'pipe',
        stderr: 'pipe',
        env: env ? { ...process.env, ...env } : process.env,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    } catch {
      return { stdout: '', stderr: 'hunk binary not found', exitCode: 127 };
    }
  }
}
