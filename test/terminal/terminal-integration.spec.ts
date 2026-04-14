/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

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
});
