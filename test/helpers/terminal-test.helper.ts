import type { ExecResult } from '../../src/shared/types';

export class TerminalTestHelper {
  static execResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return {
      stdout: overrides.stdout ?? '',
      stderr: overrides.stderr ?? '',
      exitCode: overrides.exitCode ?? 0,
    };
  }

  static mockSpawn(
    stdout = '',
    stderr = '',
    exitCode = 0,
  ): jest.Mock {
    return jest.fn().mockReturnValue({
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

  static spawnSyncResult(
    stdout = '',
    stderr = '',
    exitCode = 0,
  ): {
    stdout: Buffer;
    stderr: Buffer;
    exitCode: number;
  } {
    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      exitCode,
    };
  }
}
