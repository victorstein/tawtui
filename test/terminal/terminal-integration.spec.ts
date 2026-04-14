/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

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

        await expect(
          service.destroySession('nonexistent-id'),
        ).rejects.toThrow(/not found/i);
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
});
