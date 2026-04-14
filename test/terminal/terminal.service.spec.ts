// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockSpawn = jest.fn();
const mockBunWrite = jest.fn().mockResolvedValue(undefined);
const mockBunHash = jest.fn().mockReturnValue(12345);

(globalThis as Record<string, unknown>).Bun = {
  spawn: mockSpawn,
  write: mockBunWrite,
  hash: mockBunHash,
};

// Mock fs functions used by persistence (prevent touching real disk)
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn().mockReturnValue('[]'),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

import { TerminalService } from '../../src/modules/terminal.service';
import { TerminalTestHelper } from '../helpers/terminal-test.helper';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function createMocks() {
  const taskwarriorService = {} as any;
  const configService = {
    getAgentTypes: jest.fn().mockReturnValue([
      {
        id: 'claude-code',
        label: 'Claude Code',
        command: 'claude',
        autoApproveFlag: '--dangerously-skip-permissions',
      },
    ]),
    getOracleConfig: jest.fn().mockReturnValue({
      pollIntervalSeconds: 300,
      slack: { userName: 'testuser' },
    }),
  } as any;
  const worktreeService = {} as any;

  return { taskwarriorService, configService, worktreeService };
}

function createService(
  mocks = createMocks(),
): { service: TerminalService; mocks: ReturnType<typeof createMocks> } {
  const service = new TerminalService(
    mocks.taskwarriorService,
    mocks.configService,
    mocks.worktreeService,
  );
  return { service, mocks };
}

/**
 * Configure mockSpawn to return a successful tmux result with optional stdout.
 * Returns the mock so callers can override per-call.
 */
function mockSpawnSuccess(stdout = '', stderr = '', exitCode = 0) {
  mockSpawn.mockReturnValue({
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdout));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderr));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
  });
}

/**
 * Configure mockSpawn to return different results for each successive call.
 * Accepts an array of [stdout, stderr, exitCode] tuples.
 */
function mockSpawnSequence(
  calls: Array<[string, string, number]>,
) {
  for (const [stdout, stderr, exitCode] of calls) {
    mockSpawn.mockReturnValueOnce({
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdout));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stderr));
          controller.close();
        },
      }),
      exited: Promise.resolve(exitCode),
    });
  }
}

describe('TerminalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all spawn calls succeed
    mockSpawnSuccess();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createSession
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createSession', () => {
    describe('Behavior', () => {
      it('should create tmux session via new-session with name, cwd, and size', async () => {
        // Calls: isTmuxInstalled (-V), new-session, set-option, list-panes
        mockSpawnSequence([
          ['tmux 3.4', '', 0],   // -V
          ['', '', 0],           // new-session
          ['', '', 0],           // set-option remain-on-exit
          ['%0', '', 0],         // list-panes
        ]);

        const { service } = createService();
        const session = await service.createSession({
          name: 'Test',
          cwd: '/tmp/test',
        });

        expect(session.name).toBe('Test');
        expect(session.cwd).toBe('/tmp/test');
        expect(session.status).toBe('running');

        // Verify the new-session call includes -d, -s, -c, -x 80, -y 24
        const newSessionCall = mockSpawn.mock.calls[1];
        const args = newSessionCall[0];
        expect(args).toContain('tmux');
        expect(args).toContain('new-session');
        expect(args).toContain('-d');
        expect(args).toContain('-c');
        expect(args).toContain('/tmp/test');
        expect(args).toContain('-x');
        expect(args).toContain('80');
        expect(args).toContain('-y');
        expect(args).toContain('24');
      });

      it('should set remain-on-exit on the session', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const { service } = createService();
        await service.createSession({ name: 'Test', cwd: '/tmp' });

        // Third call is set-option remain-on-exit
        const setOptionCall = mockSpawn.mock.calls[2];
        const args = setOptionCall[0];
        expect(args).toContain('set-option');
        expect(args).toContain('remain-on-exit');
        expect(args).toContain('on');
      });

      it('should send short commands (<2KB) via send-keys', async () => {
        const shortCmd = 'echo hello';
        mockSpawnSequence([
          ['tmux 3.4', '', 0],   // -V
          ['', '', 0],           // new-session
          ['', '', 0],           // set-option
          ['%0', '', 0],         // list-panes
          ['', '', 0],           // send-keys
        ]);

        const { service } = createService();
        await service.createSession({
          name: 'Test',
          cwd: '/tmp',
          command: shortCmd,
        });

        // Fifth call is send-keys for the short command
        const sendKeysCall = mockSpawn.mock.calls[4];
        const args = sendKeysCall[0];
        expect(args).toContain('send-keys');
        expect(args).toContain(shortCmd);
        expect(args).toContain('Enter');
        // Bun.write should NOT be called for short commands
        expect(mockBunWrite).not.toHaveBeenCalled();
      });

      it('should write long commands (>2KB) to temp script file and execute via bash wrapper', async () => {
        const longCmd = 'x'.repeat(3000);
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
          ['', '', 0],           // send-keys for wrapper
        ]);

        const { service } = createService();
        await service.createSession({
          name: 'Test',
          cwd: '/tmp',
          command: longCmd,
        });

        // Bun.write should be called with the long command content
        expect(mockBunWrite).toHaveBeenCalledTimes(1);
        const [scriptPath, content] = mockBunWrite.mock.calls[0];
        expect(scriptPath).toMatch(/tawtui-cmd-\d+\.sh$/);
        expect(content).toBe(longCmd + '\n');

        // send-keys should use the bash wrapper
        const sendKeysCall = mockSpawn.mock.calls[4];
        const args = sendKeysCall[0];
        expect(args).toContain('send-keys');
        const wrapper = args[args.indexOf('send-keys') + 2]; // skip -t and session name
        // The wrapper is the argument after the session name
        const wrapperArg = args.find(
          (a: string) => typeof a === 'string' && a.startsWith('bash '),
        );
        expect(wrapperArg).toBeDefined();
        expect(wrapperArg).toContain('bash ');
        expect(wrapperArg).toContain('; rm -f ');
      });

      it('should return a session with correct metadata', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const { service } = createService();
        const session = await service.createSession({
          name: 'Review PR',
          cwd: '/tmp/work',
          prNumber: 42,
          repoOwner: 'org',
          repoName: 'repo',
          worktreeId: 'wt-1',
          worktreePath: '/tmp/worktrees/repo',
          branchName: 'fix-bug',
        });

        expect(session.id).toMatch(/^tawtui-\d+$/);
        expect(session.tmuxPaneId).toBe('%0');
        expect(session.prNumber).toBe(42);
        expect(session.repoOwner).toBe('org');
        expect(session.repoName).toBe('repo');
        expect(session.worktreeId).toBe('wt-1');
        expect(session.worktreePath).toBe('/tmp/worktrees/repo');
        expect(session.branchName).toBe('fix-bug');
        expect(session.createdAt).toBeInstanceOf(Date);
      });
    });

    describe('Error Handling', () => {
      it('should throw when tmux is not installed', async () => {
        // -V returns non-zero → not installed
        mockSpawnSequence([['', 'not found', 1]]);

        const { service } = createService();
        await expect(
          service.createSession({ name: 'Test', cwd: '/tmp' }),
        ).rejects.toThrow('tmux is not installed');
      });

      it('should warn when send-keys fails but still return session (non-fatal)', async () => {
        const shortCmd = 'echo hello';
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],           // new-session succeeds
          ['', '', 0],           // set-option succeeds
          ['%0', '', 0],         // list-panes succeeds
          ['', 'send-keys error', 1], // send-keys fails
        ]);

        const { service } = createService();
        // Should NOT throw — send-keys failure is a warning
        const session = await service.createSession({
          name: 'Test',
          cwd: '/tmp',
          command: shortCmd,
        });

        expect(session).toBeDefined();
        expect(session.status).toBe('running');
      });

      it('should throw when new-session itself fails', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', 'server not running', 1], // new-session fails
        ]);

        const { service } = createService();
        await expect(
          service.createSession({ name: 'Test', cwd: '/tmp' }),
        ).rejects.toThrow('Failed to create tmux session');
      });
    });

    describe('Edge Cases', () => {
      it('should include cleanup (rm -f) in wrapper command for temp scripts', async () => {
        const longCmd = 'y'.repeat(3000);
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
          ['', '', 0],
        ]);

        const { service } = createService();
        await service.createSession({
          name: 'Test',
          cwd: '/tmp',
          command: longCmd,
        });

        const sendKeysCall = mockSpawn.mock.calls[4];
        const args = sendKeysCall[0] as string[];
        const wrapperArg = args.find(
          (a) => typeof a === 'string' && a.includes('rm -f'),
        );
        expect(wrapperArg).toBeDefined();
        // The script path in bash and rm -f should match
        const scriptPath = mockBunWrite.mock.calls[0][0];
        expect(wrapperArg).toContain(scriptPath);
      });

      it('should fall back to default pane ID when list-panes fails', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['', '', 1],           // list-panes fails
        ]);

        const { service } = createService();
        const session = await service.createSession({
          name: 'Test',
          cwd: '/tmp',
        });

        // Fallback: <sessionName>:0.0
        expect(session.tmuxPaneId).toMatch(/:0\.0$/);
      });

      it('should create session without command when none provided', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const { service } = createService();
        const session = await service.createSession({
          name: 'Test',
          cwd: '/tmp',
        });

        // Only 4 calls (no send-keys)
        expect(mockSpawn).toHaveBeenCalledTimes(4);
        expect(session.command).toBeUndefined();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createOracleSession
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createOracleSession', () => {
    describe('Behavior', () => {
      it('should build command with oracle prompt and channel flag', async () => {
        // Need enough spawn calls for createSession inside createOracleSession
        mockSpawnSequence([
          ['tmux 3.4', '', 0],   // isTmuxInstalled
          ['', '', 0],           // new-session
          ['', '', 0],           // set-option
          ['%0', '', 0],         // list-panes
          ['', '', 0],           // send-keys (the oracle command)
        ]);

        const { service, mocks } = createService();
        const result = await service.createOracleSession();

        expect(result.sessionId).toBeDefined();

        // The command sent to createSession includes the channel flag
        const sendKeysCall = mockSpawn.mock.calls[4];
        const args = sendKeysCall[0] as string[];
        // Find the argument that contains the oracle-channel flag
        // It could be in the Bun.write path (long command) or in send-keys args
        // The oracle prompt is very long (>2KB) so it goes through Bun.write
        if (mockBunWrite.mock.calls.length > 0) {
          // Long command path: check Bun.write content
          const scriptContent = mockBunWrite.mock.calls[0][1] as string;
          expect(scriptContent).toContain(
            '--dangerously-load-development-channels server:oracle-channel',
          );
        } else {
          // Short command path: check send-keys args
          const cmdArg = args.find(
            (a) =>
              typeof a === 'string' &&
              a.includes('oracle-channel'),
          );
          expect(cmdArg).toBeDefined();
        }
      });

      it('should tag session with isOracleSession=true', async () => {
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
          ['', '', 0],
        ]);

        const { service } = createService();
        const result = await service.createOracleSession();
        const sessions = service.listSessions();
        const oracleSession = sessions.find((s) => s.id === result.sessionId);
        expect(oracleSession?.isOracleSession).toBe(true);
      });

      it('should reuse existing running oracle session (singleton)', async () => {
        // First: create a session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
          ['', '', 0],
        ]);

        const { service } = createService();
        const first = await service.createOracleSession();

        // Reset mock call count
        mockSpawn.mockClear();

        // Second call should reuse existing session without spawning tmux
        const second = await service.createOracleSession();
        expect(second.sessionId).toBe(first.sessionId);
        // No new tmux calls since the session is reused
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should create new session if previous oracle session has status !== running', async () => {
        // Use Date.now mock to ensure distinct session IDs
        const realDateNow = Date.now;
        let tick = 1000000000000;
        Date.now = () => tick++;

        try {
          // First: create an oracle session
          mockSpawnSequence([
            ['tmux 3.4', '', 0],
            ['', '', 0],
            ['', '', 0],
            ['%0', '', 0],
            ['', '', 0],
          ]);

          const { service } = createService();
          const first = await service.createOracleSession();

          // Mark the oracle session as done
          service.updateSessionStatus(first.sessionId, 'done');

          // Set up mocks for a new session creation
          mockSpawn.mockClear();
          mockBunWrite.mockClear();
          mockSpawnSequence([
            ['tmux 3.4', '', 0],
            ['', '', 0],
            ['', '', 0],
            ['%1', '', 0],
            ['', '', 0],
          ]);

          const second = await service.createOracleSession();
          // A new session should be created (different ID)
          expect(second.sessionId).not.toBe(first.sessionId);
          // tmux calls were made for the new session
          expect(mockSpawn).toHaveBeenCalled();
        } finally {
          Date.now = realDateNow;
        }
      });

      it('should throw when claude-code agent is not configured', async () => {
        const mocks = createMocks();
        mocks.configService.getAgentTypes.mockReturnValue([]);
        const { service } = createService(mocks);

        await expect(service.createOracleSession()).rejects.toThrow(
          'Claude Code agent not configured',
        );
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // destroySession
  // ═══════════════════════════════════════════════════════════════════════════

  describe('destroySession', () => {
    describe('Behavior', () => {
      it('should kill tmux session and remove from internal sessions map', async () => {
        // Create a session first
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const { service } = createService();
        const session = await service.createSession({
          name: 'Test',
          cwd: '/tmp',
        });

        // Reset and set up destroy mock
        mockSpawn.mockClear();
        mockSpawnSuccess(); // kill-session succeeds

        await service.destroySession(session.id);

        // Verify kill-session was called
        const killCall = mockSpawn.mock.calls[0];
        const args = killCall[0] as string[];
        expect(args).toContain('kill-session');
        expect(args).toContain('-t');
        expect(args).toContain(session.tmuxSessionName);

        // Session should be removed
        expect(service.listSessions()).toHaveLength(0);
      });
    });

    describe('Validation', () => {
      it('should throw when session not found', async () => {
        const { service } = createService();
        await expect(service.destroySession('nonexistent')).rejects.toThrow(
          'Session not found: nonexistent',
        );
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // pasteText
  // ═══════════════════════════════════════════════════════════════════════════

  describe('pasteText', () => {
    /** Helper: create a session so pasteText has something to target. */
    async function createTestSession(service: TerminalService) {
      mockSpawnSequence([
        ['tmux 3.4', '', 0],
        ['', '', 0],
        ['', '', 0],
        ['%0', '', 0],
      ]);
      return service.createSession({ name: 'Test', cwd: '/tmp' });
    }

    describe('Behavior', () => {
      it('should use set-buffer + paste-buffer with -p flag', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        // set-buffer succeeds, paste-buffer succeeds
        mockSpawnSequence([
          ['', '', 0], // set-buffer
          ['', '', 0], // paste-buffer
        ]);

        await service.pasteText(session.id, 'hello world');

        // First call: set-buffer
        const setBufferArgs = mockSpawn.mock.calls[0][0] as string[];
        expect(setBufferArgs).toContain('set-buffer');
        expect(setBufferArgs).toContain('--');
        expect(setBufferArgs).toContain('hello world');

        // Second call: paste-buffer with -p
        const pasteBufferArgs = mockSpawn.mock.calls[1][0] as string[];
        expect(pasteBufferArgs).toContain('paste-buffer');
        expect(pasteBufferArgs).toContain('-p');
        expect(pasteBufferArgs).toContain('-t');
        expect(pasteBufferArgs).toContain(session.tmuxPaneId);
      });
    });

    describe('Validation', () => {
      it('should throw when session not found', async () => {
        const { service } = createService();
        await expect(
          service.pasteText('nonexistent', 'text'),
        ).rejects.toThrow('Session not found: nonexistent');
      });

      it('should return early on empty text', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        await service.pasteText(session.id, '');

        // No tmux calls should be made for empty text
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('should fall back to send-keys when set-buffer fails', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        mockSpawnSequence([
          ['', 'set-buffer failed', 1], // set-buffer fails
          ['', '', 0],                   // fallback send-keys succeeds
        ]);

        // Should not throw — falls back to send-keys
        await service.pasteText(session.id, 'fallback text');

        // Verify fallback: sendInput is called which invokes send-keys
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        const fallbackArgs = mockSpawn.mock.calls[1][0] as string[];
        expect(fallbackArgs).toContain('send-keys');
        expect(fallbackArgs).toContain('-l');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // captureOutput
  // ═══════════════════════════════════════════════════════════════════════════

  describe('captureOutput', () => {
    /** Helper: create a session for capture tests. */
    async function createTestSession(service: TerminalService) {
      mockSpawnSequence([
        ['tmux 3.4', '', 0],
        ['', '', 0],
        ['', '', 0],
        ['%0', '', 0],
      ]);
      return service.createSession({ name: 'Test', cwd: '/tmp' });
    }

    describe('Behavior', () => {
      it('should capture pane content via capture-pane', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        mockSpawnSequence([
          ['$ echo hello\nhello\n$', '', 0], // capture-pane
          ['5,3,0', '', 0],                   // display-message (cursor)
        ]);
        // Bun.hash returns a consistent value
        mockBunHash.mockReturnValueOnce(99999);

        const result = await service.captureOutput(session.id);

        expect(result.content).toContain('hello');
        expect(result.cursor).toEqual({ x: 5, y: 3 });

        // Verify capture-pane call includes -p, -e, -S flags
        const captureArgs = mockSpawn.mock.calls[0][0] as string[];
        expect(captureArgs).toContain('capture-pane');
        expect(captureArgs).toContain('-p');
        expect(captureArgs).toContain('-e');
        expect(captureArgs).toContain('-S');
        expect(captureArgs).toContain('-t');
        expect(captureArgs).toContain(session.tmuxPaneId);
      });

      it('should detect content changes between captures (changed flag)', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        // First capture
        mockSpawn.mockClear();
        mockSpawnSequence([
          ['output v1', '', 0],
          ['0,0,0', '', 0],
        ]);
        mockBunHash.mockReturnValueOnce(11111);

        const first = await service.captureOutput(session.id);
        expect(first.changed).toBe(true); // First capture is always "changed"

        // Second capture with SAME content hash
        mockSpawn.mockClear();
        mockSpawnSequence([
          ['output v1', '', 0],
          // No cursor call expected since content unchanged + cached cursor exists
        ]);
        mockBunHash.mockReturnValueOnce(11111); // Same hash

        const second = await service.captureOutput(session.id);
        expect(second.changed).toBe(false);

        // Third capture with DIFFERENT content hash
        mockSpawn.mockClear();
        mockSpawnSequence([
          ['output v2', '', 0],
          ['2,1,0', '', 0],
        ]);
        mockBunHash.mockReturnValueOnce(22222); // Different hash

        const third = await service.captureOutput(session.id);
        expect(third.changed).toBe(true);
      });

      it('should detect pane death and update session status to done', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        mockSpawnSequence([
          ['$ exit\n', '', 0],      // capture-pane
          ['0,0,1', '', 0],         // display-message: pane_dead = 1
        ]);
        mockBunHash.mockReturnValueOnce(33333);

        await service.captureOutput(session.id);

        // Session status should now be 'done'
        const sessions = service.listSessions();
        const updated = sessions.find((s) => s.id === session.id);
        expect(updated?.status).toBe('done');
      });
    });

    describe('Validation', () => {
      it('should throw when session not found', async () => {
        const { service } = createService();
        await expect(service.captureOutput('nonexistent')).rejects.toThrow(
          'Session not found: nonexistent',
        );
      });
    });

    describe('Error Handling', () => {
      it('should throw when capture-pane fails', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        mockSpawn.mockClear();
        mockSpawnSequence([['', 'capture failed', 1]]);

        await expect(service.captureOutput(session.id)).rejects.toThrow(
          'Failed to capture pane',
        );
      });
    });

    describe('Edge Cases', () => {
      it('should use cached cursor when content is unchanged and not a refresh poll', async () => {
        const { service } = createService();
        const session = await createTestSession(service);

        // First capture: establishes the hash and cursor cache
        mockSpawn.mockClear();
        mockSpawnSequence([
          ['unchanged content', '', 0],
          ['10,5,0', '', 0], // cursor query
        ]);
        mockBunHash.mockReturnValueOnce(44444);

        const first = await service.captureOutput(session.id);
        expect(first.cursor).toEqual({ x: 10, y: 5 });

        // Second capture: same hash, should use cached cursor (no cursor query)
        mockSpawn.mockClear();
        mockSpawnSequence([
          ['unchanged content', '', 0],
          // No second spawn call expected — cursor is cached
        ]);
        mockBunHash.mockReturnValueOnce(44444);

        const second = await service.captureOutput(session.id);
        // Only 1 spawn call (capture-pane), not 2
        expect(mockSpawn).toHaveBeenCalledTimes(1);
        expect(second.cursor).toEqual({ x: 10, y: 5 }); // cached
        expect(second.changed).toBe(false);
      });
    });
  });
});
