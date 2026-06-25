/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

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
import type {
  PrReviewComment,
  PullRequestDetail,
} from '../../src/modules/github.types';

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
  } as any;
  const worktreeService = {} as any;

  return { taskwarriorService, configService, worktreeService };
}

function createService(mocks = createMocks()): {
  service: TerminalService;
  mocks: ReturnType<typeof createMocks>;
} {
  const service = new TerminalService(
    mocks.taskwarriorService,
    mocks.configService,
    mocks.worktreeService,
  );
  return { service, mocks };
}

/**
 * Configure mockSpawn to return different results for each successive call.
 * Accepts an array of [stdout, stderr, exitCode] tuples.
 */
function mockSpawnSequence(calls: Array<[string, string, number]>) {
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

describe('TerminalService Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnSuccess();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================================================================
  // State Machine Violations
  // ================================================================
  describe('State Machine Violations', () => {
    // SM-4: destroySession on non-existent session
    describe('SM-4: destroySession on non-existent session', () => {
      it('should throw error with "not found" when destroying a non-existent session', async () => {
        const { service } = createService();

        await expect(service.destroySession('nonexistent-id')).rejects.toThrow(
          /not found/i,
        );
      });
    });

    // SM-5: captureOutput on dead pane
    describe('SM-5: captureOutput on dead pane', () => {
      it('should return content and update session status to done when pane is dead', async () => {
        const { service } = createService();

        // First: create a session (requires 4 spawn calls)
        mockSpawnSequence([
          ['tmux 3.4', '', 0], // isTmuxInstalled → tmux -V
          ['', '', 0], // new-session
          ['', '', 0], // set-option remain-on-exit
          ['%0', '', 0], // list-panes
        ]);

        const session = await service.createSession({
          name: 'Test Session',
          cwd: '/tmp/test',
        });

        expect(session.status).toBe('running');

        // Now set up captureOutput mocks:
        // Call 1: capture-pane returns content
        // Call 2: display-message returns cursor with pane_dead=1
        mockSpawnSequence([
          ['some terminal output\n', '', 0], // capture-pane
          ['0,0,1', '', 0], // display-message with pane_dead=1
        ]);

        // When: captureOutput is called
        const result = await service.captureOutput(session.id);

        // Then: returns content successfully
        expect(result.content).toContain('some terminal output');
        expect(result.cursor).toEqual({ x: 0, y: 0 });

        // And: session status is updated to 'done' because pane_dead=1
        const updatedSession = service.getSession(session.id);
        expect(updatedSession?.status).toBe('done');
      });
    });
  });

  // ================================================================
  // Session Lifecycle
  // ================================================================
  describe('Session Lifecycle', () => {
    // TS-SL-1: Full session lifecycle (create → capture → destroy)
    describe('TS-SL-1: Full session lifecycle', () => {
      it('should create, capture output from, and destroy a session', async () => {
        const { service } = createService();

        // Given: mock the 4 spawn calls for createSession
        mockSpawnSequence([
          ['tmux 3.4', '', 0], // isTmuxInstalled → tmux -V
          ['', '', 0], // new-session
          ['', '', 0], // set-option remain-on-exit
          ['%0', '', 0], // list-panes
        ]);

        // When: createSession is called
        const session = await service.createSession({
          name: 'Lifecycle Test',
          cwd: '/tmp/lifecycle',
        });

        // Then: session is running and listed
        expect(session.status).toBe('running');
        expect(service.listSessions()).toHaveLength(1);
        expect(service.getSession(session.id)).toBeDefined();

        // Given: mock the 2 spawn calls for captureOutput
        mockSpawnSequence([
          ['hello from tmux\n', '', 0], // capture-pane
          ['5,3,0', '', 0], // display-message (cursor + pane alive)
        ]);

        // When: captureOutput is called
        const result = await service.captureOutput(session.id);

        // Then: content and cursor are returned correctly
        expect(result.content).toContain('hello from tmux');
        expect(result.cursor).toEqual({ x: 5, y: 3 });

        // Given: mock the 1 spawn call for destroySession
        mockSpawnSequence([
          ['', '', 0], // kill-session
        ]);

        // When: destroySession is called
        await service.destroySession(session.id);

        // Then: session is removed
        expect(service.listSessions()).toHaveLength(0);
        expect(service.getSession(session.id)).toBeUndefined();
      });
    });

    // TS-SL-2: Long command uses temp script path
    describe('TS-SL-2: Long command uses temp script path', () => {
      it('should write a temp script for commands exceeding 2048 chars', async () => {
        const { service } = createService();

        const longCommand = 'x'.repeat(3000);

        // Given: mock 4 setup calls + 1 send-keys call for the wrapper
        mockSpawnSequence([
          ['tmux 3.4', '', 0], // isTmuxInstalled → tmux -V
          ['', '', 0], // new-session
          ['', '', 0], // set-option remain-on-exit
          ['%0', '', 0], // list-panes
          ['', '', 0], // send-keys (wrapper script)
        ]);

        // When: createSession is called with a long command
        await service.createSession({
          name: 'Long Command Test',
          cwd: '/tmp/longcmd',
          command: longCommand,
        });

        // Then: Bun.write was called with a temp script path and the long command content
        expect(mockBunWrite).toHaveBeenCalledTimes(1);
        const [writePath, writeContent] = mockBunWrite.mock.calls[0] as [
          string,
          string,
        ];
        expect(writePath).toContain('tawtui-cmd-');
        expect(writeContent).toBe(longCommand + '\n');

        // And: the send-keys call includes 'bash' (the wrapper command)
        const sendKeysCall = mockSpawn.mock.calls[4] as [string[], unknown];
        const sendKeysArgs = sendKeysCall[0];
        expect(sendKeysArgs).toContain('send-keys');
        // The wrapper arg should start with 'bash'
        const wrapperArg = sendKeysArgs.find((arg: string) =>
          arg.startsWith('bash'),
        );
        expect(wrapperArg).toBeDefined();
      });
    });

    // TS-SL-3: createSession when tmux not installed
    describe('TS-SL-3: createSession when tmux not installed', () => {
      it('should throw when tmux is not installed', async () => {
        const { service } = createService();

        // Given: tmux -V fails
        mockSpawnSequence([['', 'not found', 1]]);

        // When/Then: createSession rejects with a tmux not installed error
        await expect(
          service.createSession({
            name: 'No Tmux Test',
            cwd: '/tmp/notmux',
          }),
        ).rejects.toThrow(/tmux is not installed/);
      });
    });

    // TS-SL-4: createSession when new-session fails
    describe('TS-SL-4: createSession when new-session fails', () => {
      it('should throw when tmux new-session returns a non-zero exit code', async () => {
        const { service } = createService();

        // Given: tmux -V succeeds but new-session fails
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', 'duplicate session', 1],
        ]);

        // When/Then: createSession rejects with a failed to create error
        await expect(
          service.createSession({
            name: 'Fail Session Test',
            cwd: '/tmp/failsession',
          }),
        ).rejects.toThrow(/Failed to create tmux session/);
      });
    });
  });

  // ================================================================
  // Key Mapping
  // ================================================================
  describe('Key Mapping', () => {
    // TS-KM-1: Special key mapping
    describe('TS-KM-1: Special key mapping', () => {
      it('should send mapped special keys without -l flag', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0], // isTmuxInstalled → tmux -V
          ['', '', 0], // new-session
          ['', '', 0], // set-option remain-on-exit
          ['%0', '', 0], // list-panes
        ]);

        const session = await service.createSession({
          name: 'Key Map Test',
          cwd: '/tmp/keymap',
        });

        mockSpawn.mockClear();
        mockSpawnSuccess();

        // When: sendInput with 'return' (maps to 'Enter')
        await service.sendInput(session.id, 'return');

        // Then: spawn called with 'Enter' and no '-l' flag
        const returnCall = mockSpawn.mock.calls[0] as [string[], unknown];
        const returnArgs = returnCall[0];
        expect(returnArgs).toContain('send-keys');
        expect(returnArgs).toContain('Enter');
        expect(returnArgs).not.toContain('-l');

        mockSpawn.mockClear();
        mockSpawnSuccess();

        // When: sendInput with 'C-c' (ctrl combo)
        await service.sendInput(session.id, 'C-c');

        // Then: spawn called with 'C-c' and no '-l' flag
        const ctrlCall = mockSpawn.mock.calls[0] as [string[], unknown];
        const ctrlArgs = ctrlCall[0];
        expect(ctrlArgs).toContain('send-keys');
        expect(ctrlArgs).toContain('C-c');
        expect(ctrlArgs).not.toContain('-l');
      });
    });

    // TS-KM-2: Literal text input
    describe('TS-KM-2: Literal text input', () => {
      it('should send literal text with -l flag', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Literal Test',
          cwd: '/tmp/literal',
        });

        mockSpawn.mockClear();
        mockSpawnSuccess();

        // When: sendInput with regular text
        await service.sendInput(session.id, 'hello world');

        // Then: spawn called with '-l' and 'hello world'
        const call = mockSpawn.mock.calls[0] as [string[], unknown];
        const args = call[0];
        expect(args).toContain('send-keys');
        expect(args).toContain('-l');
        expect(args).toContain('hello world');
      });
    });

    // TS-KM-3: sendInput on non-existent session
    describe('TS-KM-3: sendInput on non-existent session', () => {
      it('should throw "Session not found" for unknown session id', async () => {
        const { service } = createService();

        // When/Then: sendInput rejects with Session not found
        await expect(service.sendInput('nonexistent', 'test')).rejects.toThrow(
          /Session not found/,
        );
      });
    });
  });

  // ================================================================
  // Capture & Change Detection
  // ================================================================
  describe('Capture & Change Detection', () => {
    // TS-CD-1: Change detection caching
    describe('TS-CD-1: Change detection caching', () => {
      it('should use cached cursor when content hash is unchanged', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Cache Test',
          cwd: '/tmp/cache',
        });

        // Set hash to a constant so content always hashes the same
        mockBunHash.mockReturnValue(42);
        mockSpawn.mockClear();

        // First captureOutput: capture-pane + display-message (1st poll always queries cursor)
        mockSpawnSequence([
          ['some output\n', '', 0], // capture-pane
          ['5,3,0', '', 0], // display-message → cursor 5,3
        ]);

        const result1 = await service.captureOutput(session.id);

        // Then: changed is true on first call (no previous hash)
        expect(result1.changed).toBe(true);
        expect(result1.cursor).toEqual({ x: 5, y: 3 });

        // Second captureOutput: only capture-pane (same hash → cached cursor, no display-message)
        mockSpawnSequence([
          ['some output\n', '', 0], // capture-pane (same content)
        ]);

        const result2 = await service.captureOutput(session.id);

        // Then: changed is false, cursor is cached
        expect(result2.changed).toBe(false);
        expect(result2.cursor).toEqual({ x: 5, y: 3 });

        // Verify display-message was called exactly once across both captures
        const displayCalls = mockSpawn.mock.calls.filter((call) => {
          const args = (call as [string[], unknown])[0];
          return args.includes('display-message');
        });
        expect(displayCalls).toHaveLength(1);
      });
    });

    // TS-CD-2: Periodic cursor refresh on 10th poll
    describe('TS-CD-2: Periodic cursor refresh on 10th poll', () => {
      it('should query cursor on 1st and 10th calls', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Poll Test',
          cwd: '/tmp/poll',
        });

        // Constant hash so content is always "unchanged" after the 1st call
        mockBunHash.mockReturnValue(42);
        mockSpawn.mockClear();

        // Use mockImplementation to create fresh streams for each call
        // (ReadableStream can only be consumed once, so mockReturnValue won't work)
        mockSpawn.mockImplementation(() => ({
          stdout: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.enqueue(new TextEncoder().encode('same content\n'));
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.enqueue(new TextEncoder().encode(''));
              controller.close();
            },
          }),
          exited: Promise.resolve(0),
        }));

        // When: call captureOutput 10 times
        for (let i = 0; i < 10; i++) {
          await service.captureOutput(session.id);
        }

        // Then: display-message was called exactly 2 times (1st + 10th poll)
        const displayCalls = mockSpawn.mock.calls.filter((call) => {
          const args = (call as [string[], unknown])[0];
          return args.includes('display-message');
        });
        expect(displayCalls).toHaveLength(2);
      });
    });

    // TS-CD-3: captureOutput when capture-pane fails
    describe('TS-CD-3: captureOutput when capture-pane fails', () => {
      it('should throw when capture-pane returns a non-zero exit code', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Capture Fail Test',
          cwd: '/tmp/capfail',
        });

        // Given: capture-pane fails
        mockSpawnSequence([['', 'no pane', 1]]);

        // When/Then: captureOutput rejects
        await expect(service.captureOutput(session.id)).rejects.toThrow(
          /Failed to capture pane/,
        );
      });
    });
  });

  // ================================================================
  // Persistence
  // ================================================================
  describe('Persistence', () => {
    // TS-P-1: persistSessions failure is silent
    describe('TS-P-1: persistSessions failure is silent', () => {
      it('should not throw when writeFileSync fails', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs');
        (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
          throw new Error('EPERM');
        });

        const { service } = createService();

        // When/Then: persistSessions does not throw
        expect(() => {
          (service as any).persistSessions();
        }).not.toThrow();
      });
    });

    // TS-P-2: loadPersistedSessions with empty/corrupt file
    describe('TS-P-2: loadPersistedSessions with empty/corrupt file', () => {
      it('should return empty Map for empty or corrupt session file', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs');

        const { service } = createService();

        // Case 1: empty file
        (fs.existsSync as jest.Mock).mockReturnValueOnce(true);
        (fs.readFileSync as jest.Mock).mockReturnValueOnce('');

        const result1 = (service as any).loadPersistedSessions() as Map<
          string,
          unknown
        >;
        expect(result1.size).toBe(0);

        // Case 2: truncated JSON
        (fs.existsSync as jest.Mock).mockReturnValueOnce(true);
        (fs.readFileSync as jest.Mock).mockReturnValueOnce(
          '[{"tmuxSessionName":',
        );

        const result2 = (service as any).loadPersistedSessions() as Map<
          string,
          unknown
        >;
        expect(result2.size).toBe(0);
      });
    });

    // TS-P-3: discoverExistingSessions with no tmux server
    describe('TS-P-3: discoverExistingSessions with no tmux server', () => {
      it('should not crash and return no sessions when tmux server is down', async () => {
        const { service } = createService();

        // Given: list-sessions fails (no tmux server)
        mockSpawnSequence([['', 'no server running', 1]]);

        // When: discoverExistingSessions is called
        await (service as any).discoverExistingSessions();

        // Then: no sessions registered, no crash
        expect(service.listSessions()).toHaveLength(0);
      });
    });
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // TS-BC-1: pasteText fallback when set-buffer fails
    describe('TS-BC-1: pasteText fallback when set-buffer fails', () => {
      it('should fall back to send-keys when set-buffer fails', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Paste Fallback Test',
          cwd: '/tmp/pastefb',
        });

        mockSpawn.mockClear();

        // Given: set-buffer fails, then send-keys (fallback) succeeds
        mockSpawnSequence([
          ['', 'error', 1], // set-buffer fails
          ['', '', 0], // send-keys fallback succeeds
        ]);

        // When: pasteText is called
        await service.pasteText(session.id, 'some text');

        // Then: no exception, and send-keys was called with -l as fallback
        const sendKeysCall = mockSpawn.mock.calls.find((call) => {
          const args = (call as [string[], unknown])[0];
          return args.includes('send-keys');
        });
        expect(sendKeysCall).toBeDefined();
        const args = (sendKeysCall as [string[], unknown])[0];
        expect(args).toContain('-l');
      });
    });

    // TS-BC-2: pasteText with empty string
    describe('TS-BC-2: pasteText with empty string', () => {
      it('should return immediately without calling tmux for empty text', async () => {
        const { service } = createService();

        // Given: a running session
        mockSpawnSequence([
          ['tmux 3.4', '', 0],
          ['', '', 0],
          ['', '', 0],
          ['%0', '', 0],
        ]);

        const session = await service.createSession({
          name: 'Empty Paste Test',
          cwd: '/tmp/emptypaste',
        });

        mockSpawn.mockClear();

        // When: pasteText is called with empty string
        await service.pasteText(session.id, '');

        // Then: no spawn calls were made (early return)
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });
  });

  // ================================================================
  // Concurrency
  // ================================================================
  describe('Concurrency', () => {
    describe('TS-CC-2: Concurrent PR review session creation coalesces', () => {
      it('should return the same session ID when createPrReviewSession is called concurrently for the same PR', async () => {
        // Given: mocks for taskwarrior and worktree dependencies
        const mocks = createMocks();
        mocks.taskwarriorService.getTask = jest.fn().mockReturnValue(null);
        mocks.taskwarriorService.createTask = jest.fn().mockReturnValue({
          uuid: 'task-uuid-1',
          description: 'Review PR #123',
        });
        mocks.taskwarriorService.startTask = jest.fn();
        mocks.worktreeService.createWorktree = jest
          .fn()
          .mockResolvedValue({ id: 'wt-1', path: '/tmp/worktrees/repo' });
        mocks.worktreeService.linkSession = jest.fn();

        let spawnCallCount = 0;
        mockSpawn.mockImplementation(() => {
          spawnCallCount++;
          const responses: Array<[string, string, number]> = [
            ['tmux 3.4', '', 0], // isTmuxInstalled
            ['', '', 0], // new-session
            ['', '', 0], // set-option
            ['%0', '', 0], // list-panes
            ['', '', 0], // send-keys
          ];
          const idx = Math.min(spawnCallCount - 1, responses.length - 1);
          const [stdout, stderr, exitCode] = responses[idx];
          return {
            stdout: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(stdout));
                controller.close();
              },
            }),
            stderr: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(stderr));
                controller.close();
              },
            }),
            exited: Promise.resolve(exitCode),
          };
        });

        const { service } = createService(mocks);

        // When: two concurrent calls for the same PR without awaiting the first
        const [result1, result2] = await Promise.all([
          service.createPrReviewSession(123, 'owner', 'repo', 'Fix bug'),
          service.createPrReviewSession(123, 'owner', 'repo', 'Fix bug'),
        ]);

        // Then: both resolve to the same session ID
        expect(result1.sessionId).toBe(result2.sessionId);

        // And: only one tmux session was created
        expect(spawnCallCount).toBeLessThanOrEqual(5);

        // And: only one worktree was created
        expect(mocks.worktreeService.createWorktree).toHaveBeenCalledTimes(1);
      });
    });

    describe('TS-CC-4: Different PRs create separate sessions concurrently', () => {
      it('should allow separate PR review sessions for different PRs concurrently', async () => {
        // Given: mocks for taskwarrior and worktree dependencies
        const mocks = createMocks();
        let taskCounter = 0;
        mocks.taskwarriorService.getTask = jest.fn().mockReturnValue(null);
        mocks.taskwarriorService.createTask = jest
          .fn()
          .mockImplementation(() => {
            taskCounter++;
            return {
              uuid: `task-uuid-${taskCounter}`,
              description: `Review PR`,
            };
          });
        mocks.taskwarriorService.startTask = jest.fn();
        mocks.worktreeService.linkSession = jest.fn();

        let worktreeCounter = 0;
        mocks.worktreeService.createWorktree = jest
          .fn()
          .mockImplementation(() => {
            worktreeCounter++;
            return Promise.resolve({
              id: `wt-${worktreeCounter}`,
              path: `/tmp/worktrees/repo-${worktreeCounter}`,
            });
          });

        // Given: mockSpawn creates fresh streams for each call (concurrent consumption)
        mockSpawn.mockImplementation(() => {
          return {
            stdout: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(''));
                controller.close();
              },
            }),
            stderr: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(''));
                controller.close();
              },
            }),
            exited: Promise.resolve(0),
          };
        });

        // Use Date.now mock to ensure distinct session IDs
        const realDateNow = Date.now;
        let tick = 3000000000000;
        Date.now = () => tick++;

        try {
          const { service } = createService(mocks);

          // When: two concurrent calls for different PRs
          const [result1, result2] = await Promise.all([
            service.createPrReviewSession(1, 'owner', 'repo', 'PR one'),
            service.createPrReviewSession(2, 'owner', 'repo', 'PR two'),
          ]);

          // Then: both succeed with different session IDs
          expect(result1.sessionId).toBeDefined();
          expect(result2.sessionId).toBeDefined();
          expect(result1.sessionId).not.toBe(result2.sessionId);

          // And: two separate worktrees were created
          expect(mocks.worktreeService.createWorktree).toHaveBeenCalledTimes(2);

          // And: two separate tasks were created
          expect(mocks.taskwarriorService.createTask).toHaveBeenCalledTimes(2);
        } finally {
          Date.now = realDateNow;
        }
      });
    });
  });

  // ================================================================
  // PR Review Context File
  // ================================================================
  describe('createPrReviewSession context file', () => {
    describe('Behavior', () => {
      it('should tag inline review comments with [RESOLVED]/[OUTDATED] based on thread state in .tawtui-pr-context.md', async () => {
        // Given: mocks for taskwarrior and worktree dependencies
        const mocks = createMocks();
        mocks.taskwarriorService.getTask = jest.fn().mockReturnValue(null);
        mocks.taskwarriorService.createTask = jest.fn().mockReturnValue({
          uuid: 'task-uuid-tags',
          description: 'Review PR #99',
        });
        mocks.taskwarriorService.startTask = jest.fn();
        mocks.worktreeService.createWorktree = jest.fn().mockResolvedValue({
          id: 'wt-tags',
          path: '/tmp/worktrees/repo-tags',
        });
        mocks.worktreeService.linkSession = jest.fn();

        // Given: spawn returns tmux setup responses (version check, new-session, set-option, list-panes, send-keys)
        let spawnCallCount = 0;
        mockSpawn.mockImplementation(() => {
          spawnCallCount++;
          const responses: Array<[string, string, number]> = [
            ['tmux 3.4', '', 0], // isTmuxInstalled
            ['', '', 0], // new-session
            ['', '', 0], // set-option
            ['%0', '', 0], // list-panes
            ['', '', 0], // send-keys
          ];
          const idx = Math.min(spawnCallCount - 1, responses.length - 1);
          const [stdout, stderr, exitCode] = responses[idx];
          return {
            stdout: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(stdout));
                controller.close();
              },
            }),
            stderr: new ReadableStream({
              start(controller: ReadableStreamDefaultController) {
                controller.enqueue(new TextEncoder().encode(stderr));
                controller.close();
              },
            }),
            exited: Promise.resolve(exitCode),
          };
        });

        // Given: fs.writeFileSync is mocked — capture the context file write
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs');

        // Given: a PR detail (the markdown context file is only written when prDetail is provided)
        const prDetail: PullRequestDetail = {
          number: 99,
          title: 'Test PR',
          url: 'https://example.com/pr/99',
          author: { login: 'octocat' },
          state: 'OPEN',
          isDraft: false,
          headRefName: 'feature',
          baseRefName: 'main',
          reviewDecision: null,
          statusCheckRollup: [],
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          labels: [],
          body: 'PR body',
          reviews: [],
          files: [{ path: 'src/foo.ts', additions: 1, deletions: 0 }],
          comments: [],
        };

        // Given: review comments — resolved (with reply), outdated, open
        const reviewComments: PrReviewComment[] = [
          {
            id: 1001,
            user: { login: 'alice' },
            body: 'This is in a resolved thread',
            path: 'src/foo.ts',
            line: 10,
            created_at: '2026-01-01T00:00:00Z',
            isResolved: true,
          },
          {
            id: 1002,
            user: { login: 'bob' },
            body: 'Reply on resolved thread',
            path: 'src/foo.ts',
            line: 10,
            created_at: '2026-01-01T00:01:00Z',
            in_reply_to_id: 1001,
            isResolved: true,
          },
          {
            id: 2001,
            user: { login: 'carol' },
            body: 'This is outdated',
            path: 'src/foo.ts',
            line: 20,
            created_at: '2026-01-01T00:00:00Z',
            isOutdated: true,
          },
          {
            id: 3001,
            user: { login: 'dave' },
            body: 'This is still open',
            path: 'src/foo.ts',
            line: 30,
            created_at: '2026-01-01T00:00:00Z',
          },
        ];

        const { service } = createService(mocks);

        // When: a PR review session is created with the comments
        await service.createPrReviewSession(
          99,
          'owner',
          'repo',
          'Test PR',
          prDetail,
          undefined,
          reviewComments,
        );

        // Then: writeFileSync was called for the context file
        const writeCall = (fs.writeFileSync as jest.Mock).mock.calls.find(
          (call: unknown[]) =>
            String(call[0]).endsWith('.tawtui-pr-context.md'),
        );
        expect(writeCall).toBeDefined();

        const content = String(writeCall![1]);

        // Then: each comment line is rendered with the correct tag
        const resolvedLine = content
          .split('\n')
          .find((l) => l.includes('This is in a resolved thread'));
        const outdatedLine = content
          .split('\n')
          .find((l) => l.includes('This is outdated'));
        const openLine = content
          .split('\n')
          .find((l) => l.includes('This is still open'));
        const replyLine = content
          .split('\n')
          .find((l) => l.includes('Reply on resolved thread'));

        expect(resolvedLine).toBeDefined();
        expect(resolvedLine).toContain('[RESOLVED]');
        expect(resolvedLine).not.toContain('[OUTDATED]');

        expect(outdatedLine).toBeDefined();
        expect(outdatedLine).toContain('[OUTDATED]');
        expect(outdatedLine).not.toContain('[RESOLVED]');

        expect(openLine).toBeDefined();
        expect(openLine).not.toContain('[RESOLVED]');
        expect(openLine).not.toContain('[OUTDATED]');

        expect(replyLine).toBeDefined();
        expect(replyLine).toContain('[RESOLVED]');
        expect(replyLine).not.toContain('[OUTDATED]');
      });
    });
  });

  // ================================================================
  // Mouse Wheel Forwarding
  // ================================================================
  describe('Mouse Wheel Forwarding', () => {
    async function createRunningSession(
      service: TerminalService,
    ): Promise<string> {
      mockSpawnSequence([
        ['tmux 3.4', '', 0], // isTmuxInstalled → tmux -V
        ['', '', 0], // new-session
        ['', '', 0], // set-option remain-on-exit
        ['%7', '', 0], // list-panes → pane id
      ]);
      const session = await service.createSession({
        name: 'Scroll Test',
        cwd: '/tmp/scroll',
      });
      mockSpawn.mockClear();
      mockSpawnSuccess();
      return session.id;
    }

    // TS-MW-1: wheel-up encodes SGR button 64 as hex send-keys bytes
    it('should send SGR wheel-up (button 64) as hex bytes via send-keys -H', async () => {
      const { service } = createService();
      const sessionId = await createRunningSession(service);

      await service.scrollAgent(sessionId, 'up');

      const call = mockSpawn.mock.calls[0] as [string[], unknown];
      const args = call[0];

      // ESC [ < 64 ; 2 ; 2 M  → exact byte stream for wheel-up at col=2,row=2
      expect(args).toEqual([
        'tmux',
        'send-keys',
        '-t',
        '%7',
        '-H',
        '1b',
        '5b',
        '3c',
        '36',
        '34', // "64" → wheel up
        '3b',
        '32', // col 2
        '3b',
        '32', // row 2
        '4d', // 'M'
      ]);
    });

    // TS-MW-2: wheel-down encodes SGR button 65 (differs from up by one byte)
    it('should send SGR wheel-down (button 65) as hex bytes via send-keys -H', async () => {
      const { service } = createService();
      const sessionId = await createRunningSession(service);

      await service.scrollAgent(sessionId, 'down');

      const call = mockSpawn.mock.calls[0] as [string[], unknown];
      const args = call[0];

      // Identical to wheel-up except the button digit "64" → "65".
      expect(args).toEqual([
        'tmux',
        'send-keys',
        '-t',
        '%7',
        '-H',
        '1b',
        '5b',
        '3c',
        '36',
        '35', // "65" → wheel down
        '3b',
        '32',
        '3b',
        '32',
        '4d',
      ]);
    });

    // TS-MW-3: ticks repeat the send-keys invocation
    it('should emit one send-keys call per tick', async () => {
      const { service } = createService();
      const sessionId = await createRunningSession(service);

      // Fresh response per tick — a single ReadableStream can only be read once.
      mockSpawn.mockReset();
      mockSpawnSequence([
        ['', '', 0],
        ['', '', 0],
        ['', '', 0],
      ]);

      await service.scrollAgent(sessionId, 'up', 3);

      expect(mockSpawn).toHaveBeenCalledTimes(3);
      for (const call of mockSpawn.mock.calls) {
        const args = (call as [string[], unknown])[0];
        expect(args).toContain('send-keys');
        expect(args).toContain('-H');
        expect(args).toContain('34'); // wheel-up button byte
      }
    });

    // TS-MW-4: scrolling an unknown session throws
    it('should throw when the session does not exist', async () => {
      const { service } = createService();
      await expect(service.scrollAgent('nope', 'up')).rejects.toThrow(
        /not found/,
      );
    });
  });
});
