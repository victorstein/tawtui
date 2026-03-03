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
import { ConfigService } from './config.service';
import { WorktreeService } from './worktree.service';
import type {
  TerminalSession,
  CaptureResult,
  CursorPosition,
} from './terminal.types';
import type { ExecResult } from '../shared/types';
import type { PrDiff, PullRequestDetail } from './github.types';
import type { ProjectAgentConfig } from './config.types';

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

  /** Cached cursor positions keyed by session ID. */
  private readonly cursorCache = new Map<string, CursorPosition>();

  /** Poll counters keyed by session ID, used to periodically refresh cursor. */
  private readonly pollCounters = new Map<string, number>();

  /** Number of scrollback lines to capture from tmux. */
  private static readonly CAPTURE_SCROLLBACK = 500;

  /** Maximum lines to keep after capture (safety net). */
  private static readonly MAX_CAPTURE_LINES = 500;

  /** Persistent mapping of PR key (owner/repo#number) to Taskwarrior task UUID. */
  private readonly prTaskMap = new Map<string, string>();

  private readonly sessionsDir = join(homedir(), '.config', 'tawtui');
  private readonly sessionsPath = join(this.sessionsDir, 'sessions.json');
  private readonly prTaskMapPath = join(this.sessionsDir, 'pr-tasks.json');

  constructor(
    private readonly taskwarriorService: TaskwarriorService,
    private readonly configService: ConfigService,
    private readonly worktreeService: WorktreeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    this.loadPrTaskMap();
    await this.discoverExistingSessions();
  }

  onModuleDestroy(): void {
    this.logger.log('Persisting session metadata before shutdown');
    this.persistSessions();
    this.sessions.clear();
    this.contentHashes.clear();
    this.cursorCache.clear();
    this.pollCounters.clear();
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
    worktreeId?: string;
    worktreePath?: string;
    branchName?: string;
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

    // Keep the pane alive after the process exits so we can detect completion
    // and the user can still read/scroll the final output.
    await this.execTmux([
      'set-option',
      '-t',
      tmuxSessionName,
      'remain-on-exit',
      'on',
    ]);

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
      worktreeId: opts.worktreeId,
      worktreePath: opts.worktreePath,
      branchName: opts.branchName,
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
    this.cursorCache.delete(id);
    this.pollCounters.delete(id);
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

    if (SPECIAL_KEYS.has(mapped) || /^C-[a-zA-Z]$/.test(mapped)) {
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
   * Paste text into a tmux pane using the tmux paste buffer.
   *
   * Uses `set-buffer` + `paste-buffer -p` which sends text as a single block
   * wrapped in bracketed paste sequences, unlike `send-keys -l` which sends
   * characters one at a time.
   */
  async pasteText(id: string, text: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (!text) return;

    // Load text into tmux's paste buffer
    const setResult = await this.execTmux(['set-buffer', '--', text]);

    if (setResult.exitCode !== 0) {
      // Fallback to send-keys for small text
      this.logger.warn(
        `set-buffer failed, falling back to send-keys: ${setResult.stderr.trim()}`,
      );
      await this.sendInput(id, text);
      return;
    }

    // Paste from buffer into the pane (-p enables bracketed paste wrapping)
    const pasteResult = await this.execTmux([
      'paste-buffer',
      '-t',
      session.tmuxPaneId,
      '-p',
    ]);

    if (pasteResult.exitCode !== 0) {
      throw new Error(
        `Failed to paste into session ${id}: ${pasteResult.stderr.trim()}`,
      );
    }
  }

  /**
   * Capture the current visible content of the tmux pane together with the
   * cursor position.  The `changed` flag indicates whether the content differs
   * from the previous capture for the same session.
   *
   * Optimised to:
   * 1. Only capture the last {@link CAPTURE_SCROLLBACK} lines of scrollback.
   * 2. Cap output to {@link MAX_CAPTURE_LINES} as a safety net.
   * 3. Skip the cursor query when content is unchanged and a cached cursor
   *    exists (refreshes every 10th poll to catch cursor-only moves).
   */
  async captureOutput(id: string): Promise<CaptureResult> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    // Capture pane content (with ANSI color sequences preserved).
    // Only capture the last N lines of scrollback to avoid progressive lag.
    const captureResult = await this.execTmux([
      'capture-pane',
      '-p',
      '-e',
      '-S',
      String(-TerminalService.CAPTURE_SCROLLBACK),
      '-t',
      session.tmuxPaneId,
    ]);

    if (captureResult.exitCode !== 0) {
      throw new Error(
        `Failed to capture pane for session ${id}: ${captureResult.stderr.trim()}`,
      );
    }

    const content = this.capLines(this.sanitizeOutput(captureResult.stdout));

    // Change detection via Bun.hash (fast, good distribution).
    const hash = Bun.hash(content);
    const previousHash = this.contentHashes.get(id);
    const changed = previousHash !== hash;
    this.contentHashes.set(id, hash);

    // Increment poll counter for this session.
    const pollCount = (this.pollCounters.get(id) ?? 0) + 1;
    this.pollCounters.set(id, pollCount % 10);

    // When content is unchanged, a cached cursor exists, and this is not a
    // periodic refresh poll → return early without spawning a cursor query.
    const cachedCursor = this.cursorCache.get(id);
    if (!changed && cachedCursor && pollCount % 10 !== 0) {
      return { content, cursor: cachedCursor, changed: false };
    }

    // Query cursor position (only when content changed or periodic refresh).
    const cursorResult = await this.execTmux([
      'display-message',
      '-t',
      session.tmuxPaneId,
      '-p',
      '#{cursor_x},#{cursor_y},#{pane_dead}',
    ]);

    let cursor: CursorPosition = { x: 0, y: 0 };
    if (cursorResult.exitCode === 0) {
      const parts = cursorResult.stdout.trim().split(',');
      if (parts.length >= 2) {
        cursor = {
          x: parseInt(parts[0], 10) || 0,
          y: parseInt(parts[1], 10) || 0,
        };
      }
      // Detect pane death — the process inside the pane has exited
      if (
        parts.length >= 3 &&
        parts[2] === '1' &&
        session.status === 'running'
      ) {
        this.updateSessionStatus(id, 'done');
      }
    }

    // Cache the cursor for future unchanged polls.
    this.cursorCache.set(id, cursor);

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
   * session to run the review agent inside a git worktree.
   *
   * The worktree is created via {@link WorktreeService} giving the agent full
   * codebase access at the PR branch.  A markdown briefing file is written
   * into the worktree root as `.tawtui-pr-context.md`.
   */
  async createPrReviewSession(
    prNumber: number,
    repoOwner: string,
    repoName: string,
    prTitle: string,
    prDetail?: PullRequestDetail,
    prDiff?: PrDiff,
    projectAgentConfig?: ProjectAgentConfig,
  ): Promise<{ sessionId: string }> {
    // Look up (or create) the Taskwarrior task via persistent PR-to-task map
    const prKey = `${repoOwner}/${repoName}#${prNumber}`;

    let taskUuid: string | undefined = this.prTaskMap.get(prKey);

    if (taskUuid) {
      // Verify the task still exists and isn't completed/deleted
      const existing = this.taskwarriorService.getTask(taskUuid);
      if (
        existing &&
        existing.status !== 'completed' &&
        existing.status !== 'deleted'
      ) {
        // Reuse existing task — restart if not active
        if (!existing.start) {
          this.taskwarriorService.startTask(taskUuid);
        }
      } else {
        // Task was completed/deleted — create fresh
        taskUuid = undefined;
      }
    }

    if (!taskUuid) {
      const task = this.taskwarriorService.createTask({
        description: `Review PR #${prNumber}: ${prTitle}`,
        project: `${repoOwner}/${repoName}`,
        tags: ['pr-review'],
      });
      this.taskwarriorService.startTask(task.uuid);
      taskUuid = task.uuid;
      this.prTaskMap.set(prKey, taskUuid);
      this.persistPrTaskMap();
    }

    // Return the existing session if one is already running for this PR
    const existingSession = Array.from(this.sessions.values()).find(
      (s) =>
        s.prNumber === prNumber &&
        s.repoOwner === repoOwner &&
        s.repoName === repoName &&
        s.status === 'running',
    );
    if (existingSession) {
      this.logger.log(
        `Reusing existing session ${existingSession.id} for PR #${prNumber}`,
      );
      return { sessionId: existingSession.id };
    }

    // Create (or reuse) a worktree for this PR
    const worktreeInfo = await this.worktreeService.createWorktree(
      repoOwner,
      repoName,
      prNumber,
      projectAgentConfig?.worktreeEnvFiles,
    );

    // Write the markdown context file into the worktree root
    if (prDetail) {
      const contextFilePath = join(worktreeInfo.path, '.tawtui-pr-context.md');

      const sections: string[] = [
        `# PR Review Context: #${prNumber} — ${prTitle}`,
        ``,
        `**Repository:** ${repoOwner}/${repoName}`,
        `**Branch:** ${prDetail.headRefName} → ${prDetail.baseRefName}`,
        `**Author:** ${prDetail.author.login}`,
        `**Stats:** +${prDetail.additions}/-${prDetail.deletions} across ${prDetail.changedFiles} file(s)`,
        ``,
        `## Description`,
        ``,
        prDetail.body || '_No description provided._',
        ``,
      ];

      if (prDetail.files?.length) {
        sections.push(`## Changed Files`, ``);
        for (const file of prDetail.files) {
          sections.push(
            `- \`${file.path}\` (+${file.additions}/-${file.deletions})`,
          );
        }
        sections.push(``);
      }

      if (prDiff) {
        sections.push(`## Diff`, ``, '```diff', prDiff.raw, '```');
      }

      writeFileSync(contextFilePath, sections.join('\n'), 'utf-8');
    }

    // Build the launch command using project agent config or default agent
    const agentTypes = this.configService.getAgentTypes();
    let agentDef = projectAgentConfig
      ? agentTypes.find((a) => a.id === projectAgentConfig.agentTypeId)
      : undefined;

    // Fall back to the first available agent type when no project config exists
    if (!agentDef) {
      agentDef = agentTypes[0];
    }

    let command = agentDef?.command ?? '';
    const useAutoApprove = projectAgentConfig?.autoApprove ?? false;
    if (useAutoApprove && agentDef?.autoApproveFlag) {
      command += ' ' + agentDef.autoApproveFlag;
    }

    // Build an interactive agent command with the review prompt
    if (command) {
      const reviewPrompt = [
        `Review PR #${prNumber} in ${repoOwner}/${repoName}: "${prTitle}".`,
        'Read .tawtui-pr-context.md for full context including description, changed files, and diff.',
        'You have full access to the codebase at the PR branch.',
        'Provide a thorough code review covering: code quality, potential bugs, security concerns, and suggested improvements.',
      ].join(' ');
      const escaped = reviewPrompt.replace(/'/g, "'\\''");
      command = `${command} '${escaped}'`;
    }

    // Create a terminal session for the review agent in the worktree directory
    const session = await this.createSession({
      name: `PR #${prNumber} Review`,
      cwd: worktreeInfo.path,
      command,
      prNumber,
      repoOwner,
      repoName,
      worktreeId: worktreeInfo.id,
      worktreePath: worktreeInfo.path,
      branchName: prDetail?.headRefName,
    });

    // Link the session to the worktree for bidirectional tracking
    this.worktreeService.linkSession(worktreeInfo.id, session.id);

    this.logger.log(
      `Created PR review session: task=${taskUuid}, session=${session.id}, worktree=${worktreeInfo.id}`,
    );

    return { sessionId: session.id };
  }

  /**
   * Destroy a session and optionally clean up its linked worktree.
   */
  async destroySessionWithWorktree(
    id: string,
    cleanupWorktree: boolean,
  ): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    if (cleanupWorktree && session.worktreeId) {
      try {
        await this.worktreeService.removeWorktree(session.worktreeId);
      } catch (error) {
        this.logger.warn(
          `Failed to remove worktree ${session.worktreeId}: ${error}`,
        );
      }
    }

    await this.destroySession(id);
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
   * Truncate text to the last {@link MAX_CAPTURE_LINES} lines.
   * Uses a fast-path that skips `split()` when the line count is within bounds.
   */
  private capLines(text: string): string {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') count++;
      if (count > TerminalService.MAX_CAPTURE_LINES + 10) break;
    }
    if (count <= TerminalService.MAX_CAPTURE_LINES) return text;
    const lines = text.split('\n');
    return lines.slice(-TerminalService.MAX_CAPTURE_LINES).join('\n');
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
        worktreeId: meta?.worktreeId,
        worktreePath: meta?.worktreePath,
        branchName: meta?.branchName,
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
        worktreeId: s.worktreeId,
        worktreePath: s.worktreePath,
        branchName: s.branchName,
      }));
      writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      this.logger.warn('Failed to persist session metadata');
    }
  }

  /** Persist the PR-to-task UUID mapping to disk. */
  private persistPrTaskMap(): void {
    try {
      if (!existsSync(this.sessionsDir)) {
        mkdirSync(this.sessionsDir, { recursive: true });
      }
      const data = Object.fromEntries(this.prTaskMap);
      writeFileSync(this.prTaskMapPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      this.logger.warn('Failed to persist PR task map');
    }
  }

  /** Load the PR-to-task UUID mapping from disk. */
  private loadPrTaskMap(): void {
    try {
      if (!existsSync(this.prTaskMapPath)) return;
      const text = readFileSync(this.prTaskMapPath, 'utf-8');
      const data = JSON.parse(text) as Record<string, string>;
      for (const [key, value] of Object.entries(data)) {
        if (typeof key === 'string' && typeof value === 'string') {
          this.prTaskMap.set(key, value);
        }
      }
    } catch {
      this.logger.warn('Failed to load PR task map');
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
            worktreeId: item.worktreeId as string | undefined,
            worktreePath: item.worktreePath as string | undefined,
            branchName: item.branchName as string | undefined,
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
