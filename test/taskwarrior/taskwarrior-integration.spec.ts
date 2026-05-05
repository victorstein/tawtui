/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { TaskwarriorTestHelper } from '../helpers/taskwarrior-test.helper';

// Mock Bun global before importing service
const mockSpawnSync = jest.fn();
(globalThis as Record<string, unknown>).Bun = { spawnSync: mockSpawnSync };

import { TaskwarriorService } from '../../src/modules/taskwarrior.service';

const TEST_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createService(): TaskwarriorService {
  return new TaskwarriorService();
}

describe('TaskwarriorService Integration', () => {
  let service: TaskwarriorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // TW-BC-1: Malformed JSON from task export
    it('should return empty array when task export returns truncated JSON', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult('[{"uuid":"abc"', '', 0),
      );

      const result = service.getTasks();

      expect(result).toEqual([]);
    });

    // TW-BC-2: Binary garbage from task export
    it('should return empty array when task export returns binary garbage', () => {
      const binaryGarbage = String.fromCharCode(0x80, 0x81, 0xff, 0xfe);
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult(binaryGarbage, '', 0),
      );

      const result = service.getTasks();

      expect(result).toEqual([]);
    });

    // TW-BC-3: Exit code semantics
    describe('exit code semantics', () => {
      it('should return empty array for exit code 1 with empty stdout', () => {
        mockSpawnSync.mockReturnValue(
          TaskwarriorTestHelper.spawnSyncResult('', '', 1),
        );

        const result = service.getTasks();

        expect(result).toEqual([]);
      });

      it('should return empty array for exit code 2 with configuration error', () => {
        mockSpawnSync.mockReturnValue(
          TaskwarriorTestHelper.spawnSyncResult('', 'Configuration error', 2),
        );

        const result = service.getTasks();

        expect(result).toEqual([]);
      });

      it('should return empty array for exit code 0 with empty JSON array', () => {
        mockSpawnSync.mockReturnValue(
          TaskwarriorTestHelper.spawnSyncResult('[]', '', 0),
        );

        const result = service.getTasks();

        expect(result).toEqual([]);
      });
    });

    // TW-BC-4: createTask UUID extraction failure
    it('should throw when task is created but UUID cannot be extracted or found', () => {
      mockSpawnSync.mockImplementation((cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('import')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            'Imported 1 tasks.',
            '',
            0,
          );
        }
        // description filter export (fallback path)
        if (joined.includes('export')) {
          return TaskwarriorTestHelper.spawnSyncResult('[]', '', 0);
        }
        return TaskwarriorTestHelper.spawnSyncResult('', '', 0);
      });

      expect(() => service.createTask({ description: 'test' })).toThrow(
        'Task was created but could not be retrieved',
      );
    });
  });

  // ================================================================
  // Validation
  // ================================================================
  describe('Validation', () => {
    // TW-V-1: Empty description
    it('should throw with exit code when task import rejects empty description', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult(
          '',
          'A description must be provided.',
          1,
        ),
      );

      expect(() => service.createTask({ description: '' })).toThrow(/exit 1/);
    });

    // TW-V-2: Invalid due date
    it('should throw containing "Failed to update task" for invalid due date', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult('', 'Invalid date format', 1),
      );

      expect(() =>
        service.updateTask(TEST_UUID, { due: 'not-a-date' }),
      ).toThrow(/Failed to update task/);
    });

    // TW-V-3: Invalid priority
    it('should throw with exit code for invalid priority value', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult(
          '',
          "The value 'Z' is not a valid priority.",
          1,
        ),
      );

      expect(() =>
        service.updateTask(TEST_UUID, { priority: 'Z' as any }),
      ).toThrow(/exit 1/);
    });

    // TW-V-4: Special characters in description
    it('should preserve special characters in description through create', () => {
      const specialDesc = 'task with "quotes" and backticks';
      const task = TaskwarriorTestHelper.taskJson({
        uuid: TEST_UUID,
        description: specialDesc,
      });

      mockSpawnSync.mockImplementation((cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('import')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            TaskwarriorTestHelper.importOutput(TEST_UUID),
            '',
            0,
          );
        }
        if (joined.includes('export')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            JSON.stringify([task]),
            '',
            0,
          );
        }
        return TaskwarriorTestHelper.spawnSyncResult('', '', 0);
      });

      const result = service.createTask({ description: specialDesc });

      expect(result.description).toBe(specialDesc);
    });

    // TW-V-5: validateDueDate with garbage
    it('should return invalid for garbage due date input', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult('', '', 1),
      );

      const result = service.validateDueDate('kjshdfkjhsd');

      expect(result).toEqual({ valid: false, resolved: null });
    });

    // TW-V-6: Filter with shell metacharacters
    it('should pass filter as separate array elements not shell-interpreted', () => {
      mockSpawnSync.mockReturnValue(
        TaskwarriorTestHelper.spawnSyncResult('[]', '', 0),
      );

      const result = service.getTasks('status:pending; rm -rf /');

      expect(result).toEqual([]);
      // Verify spawnSync was called with args as array (not shell string)
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
      const callArgs = mockSpawnSync.mock.calls[0][0] as string[];
      // The filter should be split on whitespace into separate elements
      expect(callArgs).toContain('status:pending;');
      expect(callArgs).toContain('rm');
      expect(callArgs).toContain('-rf');
      expect(callArgs).toContain('/');
      expect(callArgs).toContain('export');
      // Verify it's an array (not a shell string)
      expect(Array.isArray(callArgs)).toBe(true);
    });
  });

  // ================================================================
  // Failure Cascades
  // ================================================================
  describe('Failure Cascades', () => {
    // TW-FC-1: createTask with annotation failure
    it('should throw from addAnnotation when annotation fails after successful create', () => {
      mockSpawnSync.mockImplementation((cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('import')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            TaskwarriorTestHelper.importOutput(TEST_UUID),
            '',
            0,
          );
        }
        if (joined.includes('annotate')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            '',
            'Annotation failed',
            1,
          );
        }
        if (joined.includes('export')) {
          const task = TaskwarriorTestHelper.taskJson({ uuid: TEST_UUID });
          return TaskwarriorTestHelper.spawnSyncResult(
            JSON.stringify([task]),
            '',
            0,
          );
        }
        return TaskwarriorTestHelper.spawnSyncResult('', '', 0);
      });

      expect(() =>
        service.createTask({ description: 'test', annotation: 'note' }),
      ).toThrow(/Failed to annotate task/);
    });

    // TW-FC-2: updateTask partial denotation failure
    it('should throw when second denotation fails during annotation update', () => {
      const taskWithAnnotations = TaskwarriorTestHelper.taskJson({
        uuid: TEST_UUID,
        annotations: [
          { entry: '20260413T120000Z', description: 'first note' },
          { entry: '20260413T130000Z', description: 'second note' },
        ],
      });

      // For annotation-only update, the call sequence is:
      // 1. getTask (export) -> returns task with 2 annotations
      // 2. first denotate -> success
      // 3. second denotate -> failure
      let denotateCallCount = 0;
      mockSpawnSync.mockImplementation((cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('export')) {
          return TaskwarriorTestHelper.spawnSyncResult(
            JSON.stringify([taskWithAnnotations]),
            '',
            0,
          );
        }
        if (joined.includes('denotate')) {
          denotateCallCount++;
          if (denotateCallCount === 1) {
            return TaskwarriorTestHelper.spawnSyncResult('', '', 0);
          }
          return TaskwarriorTestHelper.spawnSyncResult(
            '',
            'Could not denotate',
            1,
          );
        }
        return TaskwarriorTestHelper.spawnSyncResult('', '', 0);
      });

      expect(() =>
        service.updateTask(TEST_UUID, { annotation: 'new' }),
      ).toThrow(/Failed to denotate task/);

      // Verify both denotations were attempted
      expect(denotateCallCount).toBe(2);
    });
  });
});
