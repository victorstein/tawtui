import type { Task } from '../../src/modules/taskwarrior.types';

export class TaskwarriorTestHelper {
  /** Create a mock Bun.spawnSync return value. */
  static spawnSyncResult(
    stdout = '',
    stderr = '',
    exitCode = 0,
  ): { stdout: Buffer; stderr: Buffer; exitCode: number } {
    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      exitCode,
    };
  }

  /** Create a valid Task JSON object with sensible defaults. */
  static taskJson(overrides: Partial<Task> = {}): Task {
    return {
      uuid: overrides.uuid ?? 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      status: overrides.status ?? 'pending',
      description: overrides.description ?? 'Test task',
      entry: overrides.entry ?? '20260413T120000Z',
      modified: overrides.modified ?? '20260413T120000Z',
      urgency: overrides.urgency ?? 1.0,
      ...overrides,
    };
  }

  /** Create stdout for a successful `task import`. */
  static importOutput(uuid: string): string {
    return `Importing task ${uuid}.\nImported 1 tasks.`;
  }

  /**
   * Create a routed spawnSync mock that returns different results
   * based on the command args. Routes are matched by checking if
   * the args array (joined) contains the route key.
   */
  static routedSpawnSync(
    routes: Record<
      string,
      { stdout?: string; stderr?: string; exitCode?: number }
    >,
    fallback?: { stdout?: string; stderr?: string; exitCode?: number },
  ): jest.Mock {
    return jest.fn((cmd: string[]) => {
      const joined = cmd.join(' ');
      for (const [pattern, result] of Object.entries(routes)) {
        if (joined.includes(pattern)) {
          return TaskwarriorTestHelper.spawnSyncResult(
            result.stdout ?? '',
            result.stderr ?? '',
            result.exitCode ?? 0,
          );
        }
      }
      return TaskwarriorTestHelper.spawnSyncResult(
        fallback?.stdout ?? '',
        fallback?.stderr ?? '',
        fallback?.exitCode ?? 0,
      );
    });
  }
}
