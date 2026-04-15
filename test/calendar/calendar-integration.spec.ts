// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockSpawn = jest.fn();
const mockFile = jest.fn();

(globalThis as Record<string, unknown>).Bun = {
  spawn: mockSpawn,
  file: mockFile,
};

import { CalendarService } from '../../src/modules/calendar.service';
import { TerminalTestHelper } from '../helpers/terminal-test.helper';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function createService(): CalendarService {
  return new CalendarService();
}

function mockSpawnSuccess(stdout = '', stderr = '', exitCode = 0) {
  mockSpawn.mockReturnValue(
    TerminalTestHelper.mockSpawn(stdout, stderr, exitCode)(),
  );
}

function mockSpawnThrow(error: Error) {
  mockSpawn.mockImplementation(() => {
    throw error;
  });
}

describe('CalendarService Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawnSuccess();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================================================================
  // Timeout Handling
  // ================================================================
  describe('Timeout Handling', () => {
    // CS-TH-1: execGog times out
    describe('CS-TH-1: execGog times out', () => {
      it('should reject with timed out error and kill the process', async () => {
        const killMock = jest.fn();

        // exited resolves after 500ms (well beyond the 50ms timeout)
        mockSpawn.mockReturnValue({
          stdout: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.close();
            },
          }),
          exited: new Promise<number>((resolve) =>
            setTimeout(() => resolve(0), 500),
          ),
          kill: killMock,
        });

        const service = createService();

        // 50ms timeout fires before the 500ms exited promise
        const serviceWithPrivates = service as unknown as {
          execGog(
            args: string[],
            timeoutMs?: number,
          ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
        };
        await expect(serviceWithPrivates.execGog(['test'], 50)).rejects.toThrow(
          /timed out after 50ms/,
        );

        // Verify kill was called
        expect(killMock).toHaveBeenCalled();
      }, 10000);
    });

    // CS-TH-2: isInstalled when gog binary missing
    describe('CS-TH-2: isInstalled when gog binary missing', () => {
      it('should return false when gog binary is not found', async () => {
        mockSpawnThrow(new Error('spawn ENOENT'));

        const service = createService();
        const result = await service.isInstalled();

        expect(result).toBe(false);
      });
    });

    // CS-TH-3: getEvents fails when gog returns error
    describe('CS-TH-3: getEvents fails when gog returns error', () => {
      it('should reject with Failed to get events when exitCode is non-zero', async () => {
        mockSpawnSuccess('', 'calendar error', 1);

        const service = createService();

        await expect(
          service.getEvents({
            from: '2026-04-14',
            to: '2026-04-15',
            account: 'test@test.com',
          }),
        ).rejects.toThrow(/Failed to get events/);
      });
    });
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // CS-BC-1: isAuthenticated with empty accounts
    describe('CS-BC-1: isAuthenticated with empty accounts', () => {
      it('should return false when accounts array is empty', async () => {
        mockSpawnSuccess('{"accounts":[]}', '', 0);

        const service = createService();
        const result = await service.isAuthenticated();

        expect(result).toBe(false);
      });
    });

    // CS-BC-2: isAuthenticated with malformed JSON
    describe('CS-BC-2: isAuthenticated with malformed JSON', () => {
      it('should return false when stdout is not valid JSON', async () => {
        mockSpawnSuccess('not json at all', '', 0);

        const service = createService();
        const result = await service.isAuthenticated();

        expect(result).toBe(false);
      });
    });

    // CS-BC-3: getEvents with truncated JSON
    describe('CS-BC-3: getEvents with truncated JSON', () => {
      it('should reject with Failed to parse when JSON is truncated', async () => {
        mockSpawnSuccess('{"events":[{"id":', '', 0);

        const service = createService();

        await expect(
          service.getEvents({
            from: '2026-04-14',
            to: '2026-04-15',
            account: 'test@test.com',
          }),
        ).rejects.toThrow(/Failed to parse events response/);
      });
    });

    // CS-BC-4: getEvents with events: null
    describe('CS-BC-4: getEvents with events: null', () => {
      it('should resolve to empty array when events is null', async () => {
        mockSpawnSuccess('{"events":null}', '', 0);

        const service = createService();
        const result = await service.getEvents({
          from: '2026-04-14',
          to: '2026-04-15',
          account: 'test@test.com',
        });

        expect(result).toEqual([]);
      });
    });

    // CS-BC-5: getDefaultAccount with empty array
    describe('CS-BC-5: getDefaultAccount with empty array', () => {
      it('should return null when accounts array is empty', async () => {
        mockSpawnSuccess('{"accounts":[]}', '', 0);

        const service = createService();
        const result = await service.getDefaultAccount();

        expect(result).toBeNull();
      });
    });
  });

  // ================================================================
  // Error Handling
  // ================================================================
  describe('Error Handling', () => {
    // CS-ERR-1: gog binary missing propagates through getEvents
    describe('CS-ERR-1: gog binary missing propagates through getEvents', () => {
      it('should reject with Failed to get events when binary is missing', async () => {
        mockSpawnThrow(new Error('spawn ENOENT'));

        const service = createService();

        await expect(
          service.getEvents({
            from: '2026-04-14',
            to: '2026-04-15',
            account: 'test@test.com',
          }),
        ).rejects.toThrow(/Failed to get events/);
      });
    });

    // CS-ERR-2: getEvents with no account configured
    describe('CS-ERR-2: getEvents with no account configured', () => {
      it('should reject with No Google account when no account param and none configured', async () => {
        mockSpawnSuccess('{"accounts":[]}', '', 0);

        const service = createService();

        await expect(
          service.getEvents({
            from: '2026-04-14',
            to: '2026-04-15',
          }),
        ).rejects.toThrow(/No Google account configured/);
      });
    });

    // CS-ERR-3: importCredentials fails
    describe('CS-ERR-3: importCredentials fails', () => {
      it('should return success false with error message on failure', async () => {
        mockSpawnSuccess('', 'file not found', 1);

        const service = createService();
        const result = await service.importCredentials('/bad/path');

        expect(result).toEqual({
          success: false,
          error: 'file not found',
        });
      });
    });
  });
});
