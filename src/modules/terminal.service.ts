import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type {
  TerminalSession,
  CaptureResult,
  CursorPosition,
} from './terminal.types';
import type { ExecResult } from '../shared/types';

const KEY_MAP: Record<string, string> = {
  'return': 'Enter',
  'escape': 'Escape',
  'tab': 'Tab',
  'backspace': 'BSpace',
  'up': 'Up',
  'down': 'Down',
  'left': 'Left',
  'right': 'Right',
  'space': 'Space',
  'delete': 'DC',
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
export class TerminalService implements OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);

  /** Active terminal sessions keyed by their unique ID. */
  private readonly sessions = new Map<string, TerminalSession>();

  /** Content hashes keyed by session ID, used for change detection. */
  private readonly contentHashes = new Map<string, number | bigint>();

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onModuleDestroy(): void {
    this.logger.log('Cleaning up all tmux sessions');
    for (const [id] of this.sessions) {
      try {
        this.destroySession(id);
      } catch {
        // best-effort cleanup
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check whether the `tmux` binary is available on the system.
   */
  isTmuxInstalled(): boolean {
    try {
      const proc = Bun.spawnSync(['tmux', '-V'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a new detached tmux session and return its metadata.
   */
  createSession(opts: {
    name: string;
    cwd: string;
    command?: string;
    prNumber?: number;
    repoOwner?: string;
    repoName?: string;
    taskUuid?: string;
  }): TerminalSession {
    if (!this.isTmuxInstalled()) {
      throw new Error('tmux is not installed or not available on PATH');
    }

    const id = `tawtui-${Date.now()}`;
    const tmuxSessionName = id;

    // Create a detached tmux session with the given working directory and size.
    const createResult = this.execTmux([
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
    const paneResult = this.execTmux([
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
      const sendResult = this.execTmux([
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
    this.logger.log(`Created tmux session "${tmuxSessionName}" (id=${id})`);

    return session;
  }

  /**
   * Kill a tmux session and remove it from the internal registry.
   */
  destroySession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const result = this.execTmux([
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
  sendInput(id: string, input: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Normalise the input via the KEY_MAP (e.g. "return" -> "Enter").
    const mapped = KEY_MAP[input.toLowerCase()] ?? input;

    if (SPECIAL_KEYS.has(mapped)) {
      // Send as a named key (no -l flag).
      const result = this.execTmux([
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
      const result = this.execTmux([
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
  captureOutput(id: string): CaptureResult {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Capture pane content (with ANSI escape sequences preserved).
    const captureResult = this.execTmux([
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

    const content = captureResult.stdout;

    // Query cursor position.
    const cursorResult = this.execTmux([
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
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const result = this.execTmux([
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
   * Update the status of an existing session.
   */
  updateSessionStatus(
    id: string,
    status: 'running' | 'done' | 'failed',
  ): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    session.status = status;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute a tmux command synchronously via Bun.spawnSync().
   */
  private execTmux(args: string[]): ExecResult {
    const cmd = ['tmux', ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')}`);

    const proc = Bun.spawnSync(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    const exitCode = proc.exitCode;

    if (exitCode !== 0) {
      this.logger.warn(
        `tmux exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
      );
    }

    return { stdout, stderr, exitCode };
  }

}
