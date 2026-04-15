// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockSpawn = jest.fn();

(globalThis as Record<string, unknown>).Bun = {
  spawn: mockSpawn,
};

import { NotificationService } from '../../src/modules/notification.service';
import { TerminalTestHelper } from '../helpers/terminal-test.helper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalTermProgram = process.env.TERM_PROGRAM;

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

function mockSpawnDefault(exitCode = 0) {
  mockSpawn.mockReturnValue({
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
  });
}

describe('NotificationService Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TERM_PROGRAM = 'Apple_Terminal';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalTermProgram !== undefined) {
      process.env.TERM_PROGRAM = originalTermProgram;
    } else {
      delete process.env.TERM_PROGRAM;
    }
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // NS-BC-1: send() when helper not installed
    describe('NS-BC-1: send() when helper not installed', () => {
      it('should return false without throwing when helper is not installed', async () => {
        // Given: spawn returns exitCode 1 for -help check
        mockSpawnDefault(1);
        const service = new NotificationService();

        // When: send is called
        const result = await service.send({ title: 'Test', message: 'Hello' });

        // Then: returns false, no exception
        expect(result).toBe(false);
      });
    });

    // NS-BC-2: send() when exec fails
    describe('NS-BC-2: send() when exec fails', () => {
      it('should return false when exec spawn returns non-zero exit code', async () => {
        // Given: first call (-help) succeeds, second call (exec) fails
        mockSpawnSequence([
          ['', '', 0], // isInstalled → -help → success
          ['', 'notification failed', 1], // exec → failure
        ]);
        const service = new NotificationService();

        // When: send is called
        const result = await service.send({ title: 'Test', message: 'Hello' });

        // Then: returns false (exec failed)
        expect(result).toBe(false);
      });
    });

    // NS-BC-3: send() when spawn throws on exec
    describe('NS-BC-3: send() when spawn throws on exec', () => {
      it('should return false when spawn throws during exec', async () => {
        // Given: first call (-help) succeeds → cache set to true
        mockSpawnSequence([['', '', 0]]);
        const service = new NotificationService();

        // Pre-warm the cache by calling isInstalled
        const installed = await service.isInstalled();
        expect(installed).toBe(true);

        // Now mock spawn to throw on the next call (exec)
        mockSpawn.mockImplementationOnce(() => {
          throw new Error('ENOENT: binary not found');
        });

        // When: send is called (cache says installed, but exec spawn throws)
        const result = await service.send({ title: 'Test', message: 'Hello' });

        // Then: returns false (exec's try-catch catches the throw)
        expect(result).toBe(false);
      });
    });
  });

  // ================================================================
  // Caching
  // ================================================================
  describe('Caching', () => {
    // NS-CA-1: isInstalled caches positive result
    describe('NS-CA-1: isInstalled caches positive result', () => {
      it('should call spawn only once and return cached true on subsequent calls', async () => {
        // Given: spawn returns exitCode 0 for -help check
        mockSpawnDefault(0);
        const service = new NotificationService();

        // When: isInstalled is called twice
        const result1 = await service.isInstalled();
        const result2 = await service.isInstalled();

        // Then: both return true
        expect(result1).toBe(true);
        expect(result2).toBe(true);

        // And: spawn was called only once (for the first -help check)
        expect(mockSpawn).toHaveBeenCalledTimes(1);
      });
    });

    // NS-CA-2: isInstalled caches negative result
    describe('NS-CA-2: isInstalled caches negative result', () => {
      it('should call spawn only once and return cached false on subsequent calls', async () => {
        // Given: spawn throws (binary not found)
        mockSpawn.mockImplementation(() => {
          throw new Error('binary not found');
        });
        const service = new NotificationService();

        // When: isInstalled is called twice
        const result1 = await service.isInstalled();
        const result2 = await service.isInstalled();

        // Then: both return false
        expect(result1).toBe(false);
        expect(result2).toBe(false);

        // And: spawn was called only once (first call threw, cached false)
        expect(mockSpawn).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ================================================================
  // Argument Building
  // ================================================================
  describe('Argument Building', () => {
    // NS-AB-1: Full payload includes all flags
    describe('NS-AB-1: Full payload includes all flags', () => {
      it('should include all flags for a full payload', async () => {
        // Given: both spawn calls succeed
        mockSpawnSequence([
          ['', '', 0], // isInstalled → -help → success
          ['', '', 0], // exec → success
        ]);
        const service = new NotificationService();

        // When: send is called with full payload
        const result = await service.send({
          title: 'T',
          message: 'M',
          subtitle: 'S',
          appIcon: '/icon.png',
        });

        // Then: send returns true
        expect(result).toBe(true);

        // And: the second spawn call (exec) contains all expected flags
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        const execCall = mockSpawn.mock.calls[1] as [string[], unknown];
        const execArgs = execCall[0];

        // Verify each flag and value pair
        const titleIdx = execArgs.indexOf('-title');
        expect(titleIdx).toBeGreaterThan(0); // after binary path
        expect(execArgs[titleIdx + 1]).toBe('T');

        const messageIdx = execArgs.indexOf('-message');
        expect(messageIdx).toBeGreaterThan(0);
        expect(execArgs[messageIdx + 1]).toBe('M');

        const subtitleIdx = execArgs.indexOf('-subtitle');
        expect(subtitleIdx).toBeGreaterThan(0);
        expect(execArgs[subtitleIdx + 1]).toBe('S');

        const appIconIdx = execArgs.indexOf('-appIcon');
        expect(appIconIdx).toBeGreaterThan(0);
        expect(execArgs[appIconIdx + 1]).toBe('/icon.png');

        const soundIdx = execArgs.indexOf('-sound');
        expect(soundIdx).toBeGreaterThan(0);
        expect(execArgs[soundIdx + 1]).toBe('default');

        const activateIdx = execArgs.indexOf('-activate');
        expect(activateIdx).toBeGreaterThan(0);
        expect(execArgs[activateIdx + 1]).toBe('com.apple.Terminal');
      });
    });

    // NS-AB-2: Minimal payload omits optional flags
    describe('NS-AB-2: Minimal payload omits optional flags', () => {
      it('should not include -subtitle or -appIcon for minimal payload', async () => {
        // Given: both spawn calls succeed
        mockSpawnSequence([
          ['', '', 0], // isInstalled → -help → success
          ['', '', 0], // exec → success
        ]);
        const service = new NotificationService();

        // When: send is called with minimal payload (no subtitle, no appIcon)
        const result = await service.send({
          title: 'T',
          message: 'M',
        });

        // Then: send returns true
        expect(result).toBe(true);

        // And: the second spawn call does NOT contain -subtitle or -appIcon
        expect(mockSpawn).toHaveBeenCalledTimes(2);
        const execCall = mockSpawn.mock.calls[1] as [string[], unknown];
        const execArgs = execCall[0];

        expect(execArgs).not.toContain('-subtitle');
        expect(execArgs).not.toContain('-appIcon');

        // But still has required flags
        expect(execArgs).toContain('-title');
        expect(execArgs).toContain('-message');
        expect(execArgs).toContain('-sound');
        expect(execArgs).toContain('-activate');
      });
    });
  });

  // ================================================================
  // Terminal Detection
  // ================================================================
  describe('Terminal Detection', () => {
    // NS-TD-1: Known terminal (ghostty)
    describe('NS-TD-1: Known terminal (ghostty)', () => {
      it('should use com.mitchellh.ghostty bundle ID for ghostty terminal', async () => {
        // Given: TERM_PROGRAM is ghostty
        process.env.TERM_PROGRAM = 'ghostty';
        mockSpawnSequence([
          ['', '', 0], // isInstalled
          ['', '', 0], // exec
        ]);
        const service = new NotificationService();

        // When: send is called
        await service.send({ title: 'T', message: 'M' });

        // Then: the -activate flag uses ghostty's bundle ID
        const execCall = mockSpawn.mock.calls[1] as [string[], unknown];
        const execArgs = execCall[0];
        const activateIdx = execArgs.indexOf('-activate');
        expect(execArgs[activateIdx + 1]).toBe('com.mitchellh.ghostty');
      });
    });

    // NS-TD-2: Unknown terminal
    describe('NS-TD-2: Unknown terminal', () => {
      it('should fall back to com.apple.Terminal for unknown terminal', async () => {
        // Given: TERM_PROGRAM is an unknown terminal
        process.env.TERM_PROGRAM = 'SomeUnknownTerminal';
        mockSpawnSequence([
          ['', '', 0], // isInstalled
          ['', '', 0], // exec
        ]);
        const service = new NotificationService();

        // When: send is called
        await service.send({ title: 'T', message: 'M' });

        // Then: the -activate flag falls back to default
        const execCall = mockSpawn.mock.calls[1] as [string[], unknown];
        const execArgs = execCall[0];
        const activateIdx = execArgs.indexOf('-activate');
        expect(execArgs[activateIdx + 1]).toBe('com.apple.Terminal');
      });
    });

    // NS-TD-3: No TERM_PROGRAM set
    describe('NS-TD-3: No TERM_PROGRAM', () => {
      it('should fall back to com.apple.Terminal when TERM_PROGRAM is not set', async () => {
        // Given: TERM_PROGRAM is not set
        delete process.env.TERM_PROGRAM;
        mockSpawnSequence([
          ['', '', 0], // isInstalled
          ['', '', 0], // exec
        ]);
        const service = new NotificationService();

        // When: send is called
        await service.send({ title: 'T', message: 'M' });

        // Then: the -activate flag falls back to default
        const execCall = mockSpawn.mock.calls[1] as [string[], unknown];
        const execArgs = execCall[0];
        const activateIdx = execArgs.indexOf('-activate');
        expect(execArgs[activateIdx + 1]).toBe('com.apple.Terminal');
      });
    });
  });
});
