import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { TaskwarriorService } from './taskwarrior.service';
import type {
  TerminalSession,
  CaptureResult,
  CursorPosition,
} from './terminal.types';
import type { ExecResult } from '../shared/types';

const KEY_MAP: Record<string, string> = {
  return: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'BSpace',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  space: 'Space',
  delete: 'DC',
};

/** Set of key names that tmux recognises as special send-keys targets. */
const SPECIAL_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'BSpace',
  'Up',
  'Down',
  'Left',
  'Right',
  'Space',
  'DC',
  // Ctrl- combinations
  'C-c',
  'C-d',
  'C-z',
  'C-l',
]);

@Injectable()
export class TerminalService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(TerminalService.name);

  /** Active terminal sessions keyed by their unique ID. */
  private readonly sessions = new Map<string, TerminalSession>();

  /** Content hashes keyed by session ID, used for change detection. */
  private readonly contentHashes = new Map<string, number | bigint>();

  private readonly sessionsDir = join(homedir(), '.config', 'tawtui');
  private readonly sessionsPath = join(this.sessionsDir, 'sessions.json');

  constructor(private readonly taskwarriorService: TaskwarriorService) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    await this.discoverExistingSessions();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Persisting session metadata before shutdown');
    this.persistSessions();
    this.sessions.clear();
    this.contentHashes.clear();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check whether the `tmux` binary is available on the system.
   */
  async isTmuxInstalled(): Promise<boolean> {
    try {
      const result = await this.execTmux(['-V']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a new detached tmux session and return its metadata.
   */
  async createSession(opts: {
    name: string;
    cwd: string;
    command?: string;
    prNumber?: number;
    repoOwner?: string;
    repoName?: string;
    taskUuid?: string;
  }): Promise<TerminalSession> {
    if (!(await this.isTmuxInstalled())) {
      throw new Error('tmux is not installed or not available on PATH');
    }

    const id = `tawtui-${Date.now()}`;
    const tmuxSessionName = id;

    // Create a detached tmux session with the given working directory and size.
    const createResult = await this.execTmux([
      'new-session',
      '-d',
      '-s',
      tmuxSessionName,
      '-c',
      opts.cwd,
      '-x',
      '80',
      '-y',
      '24',
    ]);

    if (createResult.exitCode !== 0) {
      throw new Error(
        `Failed to create tmux session (exit ${createResult.exitCode}): ${createResult.stderr.trim()}`,
      );
    }

    // Determine the pane ID for this session (the first — and only — pane).
    const paneResult = await this.execTmux([
      'list-panes',
      '-t',
      tmuxSessionName,
      '-F',
      '#{pane_id}',
    ]);

    const tmuxPaneId =
      paneResult.exitCode === 0 && paneResult.stdout.trim()
        ? paneResult.stdout.trim().split('\n')[0]
        : `${tmuxSessionName}:0.0`;

    // If an initial command was provided, send it to the session.
    if (opts.command) {
      const sendResult = await this.execTmux([
        'send-keys',
        '-t',
        tmuxSessionName,
        opts.command,
        'Enter',
      ]);

      if (sendResult.exitCode !== 0) {
        this.logger.warn(
          `Failed to send initial command to session ${id}: ${sendResult.stderr.trim()}`,
        );
      }
    }

    const session: TerminalSession = {
      id,
      tmuxSessionName,
      tmuxPaneId,
      name: opts.name,
      cwd: opts.cwd,
      command: opts.command,
      status: 'running',
      createdAt: new Date(),
      prNumber: opts.prNumber,
      repoOwner: opts.repoOwner,
      repoName: opts.repoName,
      taskUuid: opts.taskUuid,
    };

    this.sessions.set(id, session);
    this.persistSessions();
    this.logger.log(`Created tmux session "${tmuxSessionName}" (id=${id})`);

    return session;
  }

  /**
   * Kill a tmux session and remove it from the internal registry.
   */
  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const result = await this.execTmux([
      'kill-session',
      '-t',
      session.tmuxSessionName,
    ]);

    if (result.exitCode !== 0) {
      this.logger.warn(
        `Failed to kill tmux session "${session.tmuxSessionName}" (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }

    this.sessions.delete(id);
    this.contentHashes.delete(id);
    this.persistSessions();
    this.logger.log(
      `Destroyed tmux session "${session.tmuxSessionName}" (id=${id})`,
    );
  }

  /**
   * Forward a keystroke or text to the tmux pane.
   *
   * Special keys (Enter, Escape, Tab, BSpace, Up, Down, Left, Right, Space,
   * DC, C-c, C-d, C-z, C-l) are sent without the `-l` flag so that tmux
   * interprets them as key names.  Everything else is sent literally.
   */
  async sendInput(id: string, input: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Normalise the input via the KEY_MAP (e.g. "return" -> "Enter").
    const mapped = KEY_MAP[input.toLowerCase()] ?? input;

    if (SPECIAL_KEYS.has(mapped)) {
      // Send as a named key (no -l flag).
      const result = await this.execTmux([
        'send-keys',
        '-t',
        session.tmuxPaneId,
        mapped,
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to send key "${mapped}" to session ${id}: ${result.stderr.trim()}`,
        );
      }
    } else {
      // Send as literal text.
      const result = await this.execTmux([
        'send-keys',
        '-t',
        session.tmuxPaneId,
        '-l',
        mapped,
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to send text to session ${id}: ${result.stderr.trim()}`,
        );
      }
    }
  }

  /**
   * Capture the current visible content of the tmux pane together with the
   * cursor position.  The `changed` flag indicates whether the content differs
   * from the previous capture for the same session.
   */
  async captureOutput(id: string): Promise<CaptureResult> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Capture pane content (with ANSI color sequences preserved).
    const captureResult = await this.execTmux([
      'capture-pane',
      '-p',
      '-e',
      '-t',
      session.tmuxPaneId,
    ]);

    if (captureResult.exitCode !== 0) {
      throw new Error(
        `Failed to capture pane for session ${id}: ${captureResult.stderr.trim()}`,
      );
    }

    const content = this.sanitizeOutput(captureResult.stdout);

    // Query cursor position.
    const cursorResult = await this.execTmux([
      'display-message',
      '-t',
      session.tmuxPaneId,
      '-p',
      '#{cursor_x},#{cursor_y}',
    ]);

    let cursor: CursorPosition = { x: 0, y: 0 };
    if (cursorResult.exitCode === 0) {
      const parts = cursorResult.stdout.trim().split(',');
      if (parts.length === 2) {
        cursor = {
          x: parseInt(parts[0], 10) || 0,
          y: parseInt(parts[1], 10) || 0,
        };
      }
    }

    // Change detection via Bun.hash (fast, good distribution).
    const hash = Bun.hash(content);
    const previousHash = this.contentHashes.get(id);
    const changed = previousHash !== hash;
    this.contentHashes.set(id, hash);

    return { content, cursor, changed };
  }

  /**
   * Resize the tmux window associated with the given session.
   */
  async resize(id: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const result = await this.execTmux([
      'resize-window',
      '-t',
      session.tmuxSessionName,
      '-x',
      String(cols),
      '-y',
      String(rows),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to resize session ${id}: ${result.stderr.trim()}`,
      );
    }
  }

  /**
   * Retrieve a session by its unique ID.
   */
  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Return all currently tracked sessions.
   */
  listSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Create a Taskwarrior task for reviewing a PR and spin up a terminal
   * session to run the review agent.  Returns the task UUID and session ID.
   */
  async createPrReviewSession(
    prNumber: number,
    repoOwner: string,
    repoName: string,
    prTitle: string,
  ): Promise<{ taskUuid: string; sessionId: string }> {
    // Create a Taskwarrior task for the review
    const task = await this.taskwarriorService.createTask({
      description: `Review PR #${prNumber}: ${prTitle}`,
      project: `${repoOwner}/${repoName}`,
      tags: ['pr-review'],
    });

    // Start the task so it's marked as "in progress"
    await this.taskwarriorService.startTask(task.uuid);

    // Create a terminal session for the review agent
    const session = await this.createSession({
      name: `PR #${prNumber} Review`,
      cwd: process.cwd(),
      command: `echo "Reviewing PR #${prNumber} for ${repoOwner}/${repoName}..." && sleep 5`,
      prNumber,
      repoOwner,
      repoName,
      taskUuid: task.uuid,
    });

    this.logger.log(
      `Created PR review session: task=${task.uuid}, session=${session.id}`,
    );

    return { taskUuid: task.uuid, sessionId: session.id };
  }

  /**
   * Update the status of an existing session.
   */
  updateSessionStatus(id: string, status: 'running' | 'done' | 'failed'): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    session.status = status;
    this.persistSessions();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Strip terminal escape sequences that interfere with TUI rendering.
   */

  /* eslint-disable no-control-regex */
  private static readonly RE_MOUSE_TRACKING =
    /\x1b\[\?(1000|1002|1003|1006)[hl]/g;
  private static readonly RE_BRACKETED_PASTE = /\x1b\[\?2004[hl]/g;
  private static readonly RE_ALT_SCREEN = /\x1b\[\?(1049|47)[hl]/g;
  private static readonly RE_SGR_MOUSE = /\x1b\[<[\d;]+[Mm]/g;
  private static readonly RE_OSC = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
  /* eslint-enable no-control-regex */

  private sanitizeOutput(raw: string): string {
    return raw
      .replace(TerminalService.RE_MOUSE_TRACKING, '')
      .replace(TerminalService.RE_BRACKETED_PASTE, '')
      .replace(TerminalService.RE_ALT_SCREEN, '')
      .replace(TerminalService.RE_SGR_MOUSE, '')
      .replace(TerminalService.RE_OSC, '');
  }

  /**
   * Discover existing tawtui tmux sessions on startup to prevent zombies.
   */
  private async discoverExistingSessions(): Promise<void> {
    const result = await this.execTmux([
      'list-sessions',
      '-F',
      '#{session_name}',
    ]);

    if (result.exitCode !== 0) {
      // No tmux server running or no sessions — that's fine
      return;
    }

    const sessionNames = result.stdout
      .trim()
      .split('\n')
      .filter((name) => name.startsWith('tawtui-'));

    const persisted = this.loadPersistedSessions();

    for (const tmuxSessionName of sessionNames) {
      // Get the pane ID
      const paneResult = await this.execTmux([
        'list-panes',
        '-t',
        tmuxSessionName,
        '-F',
        '#{pane_id}',
      ]);

      const tmuxPaneId =
        paneResult.exitCode === 0 && paneResult.stdout.trim()
          ? paneResult.stdout.trim().split('\n')[0]
          : `${tmuxSessionName}:0.0`;

      const meta = persisted.get(tmuxSessionName);

      const session: TerminalSession = {
        id: meta?.id ?? tmuxSessionName,
        tmuxSessionName,
        tmuxPaneId,
        name: meta?.name ?? tmuxSessionName.replace('tawtui-', ''),
        cwd: meta?.cwd ?? process.cwd(),
        command: meta?.command,
        status: 'running',
        createdAt: new Date(),
        prNumber: meta?.prNumber,
        repoOwner: meta?.repoOwner,
        repoName: meta?.repoName,
        taskUuid: meta?.taskUuid,
      };

      this.sessions.set(session.id, session);
      this.logger.log(`Discovered existing session: ${tmuxSessionName}`);
    }

    if (sessionNames.length > 0) {
      this.logger.log(`Recovered ${sessionNames.length} existing session(s)`);
    }

    this.persistSessions();
  }

  /** Persist all session metadata to disk. */
  private persistSessions(): void {
    try {
      if (!existsSync(this.sessionsDir)) {
        mkdirSync(this.sessionsDir, { recursive: true });
      }
      const data = Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        tmuxSessionName: s.tmuxSessionName,
        tmuxPaneId: s.tmuxPaneId,
        name: s.name,
        cwd: s.cwd,
        command: s.command,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        prNumber: s.prNumber,
        repoOwner: s.repoOwner,
        repoName: s.repoName,
        taskUuid: s.taskUuid,
      }));
      writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      this.logger.warn('Failed to persist session metadata');
    }
  }

  /** Load persisted session metadata from disk. */
  private loadPersistedSessions(): Map<string, Partial<TerminalSession>> {
    const map = new Map<string, Partial<TerminalSession>>();
    try {
      if (!existsSync(this.sessionsPath)) return map;
      const text = readFileSync(this.sessionsPath, 'utf-8');
      const data = JSON.parse(text) as Array<Record<string, unknown>>;
      for (const item of data) {
        if (typeof item.tmuxSessionName === 'string') {
          map.set(item.tmuxSessionName, {
            id: item.id as string,
            name: item.name as string,
            cwd: item.cwd as string,
            command: item.command as string | undefined,
            prNumber: item.prNumber as number | undefined,
            repoOwner: item.repoOwner as string | undefined,
            repoName: item.repoName as string | undefined,
            taskUuid: item.taskUuid as string | undefined,
          });
        }
      }
    } catch {
      this.logger.warn('Failed to load persisted session metadata');
    }
    return map;
  }

  /**
   * Execute a tmux command asynchronously via Bun.spawn().
   */
  private async execTmux(args: string[]): Promise<ExecResult> {
    const cmd = ['tmux', ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')}`);

    try {
      const proc = Bun.spawn(cmd, {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.warn(
          `tmux exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
        );
      }

      return { stdout, stderr, exitCode };
    } catch {
      return {
        stdout: '',
        stderr: 'tmux binary not found',
        exitCode: 1,
      };
    }
  }
}
