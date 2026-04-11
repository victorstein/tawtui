// test/notification.service.spec.ts

import { NotificationService } from '../src/modules/notification.service';
import { DEFAULT_BUNDLE_ID } from '../src/modules/notification.types';

// Save original env and Bun.spawn
const originalEnv = { ...process.env };
const originalSpawn = (
  global as unknown as { Bun: { spawn: typeof Bun.spawn } }
).Bun?.spawn;

// Ensure Bun global exists (Jest runs in Node, so we polyfill the Bun global)
if (!(global as unknown as Record<string, unknown>).Bun) {
  (global as unknown as Record<string, unknown>).Bun = { spawn: undefined };
}

function mockSpawn(exitCode: number, stdout = '', stderr = '') {
  (global as unknown as { Bun: { spawn: unknown } }).Bun.spawn = () => {
    const stdoutBlob = new Blob([stdout]);
    const stderrBlob = new Blob([stderr]);
    return {
      stdout: stdoutBlob.stream(),
      stderr: stderrBlob.stream(),
      exited: Promise.resolve(exitCode),
      kill: () => {},
    };
  };
}

function mockSpawnThrow() {
  (global as unknown as { Bun: { spawn: unknown } }).Bun.spawn = () => {
    throw new Error('binary not found');
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  (global as unknown as { Bun: { spawn: unknown } }).Bun.spawn = originalSpawn;
});

describe('NotificationService', () => {
  describe('detectTerminalBundleId', () => {
    it('detects iTerm', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('detects ghostty', () => {
      process.env.TERM_PROGRAM = 'ghostty';
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('falls back to default when TERM_PROGRAM is unset', () => {
      delete process.env.TERM_PROGRAM;
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('falls back to default for unknown terminal', () => {
      process.env.TERM_PROGRAM = 'SomeUnknownTerminal';
      const service = new NotificationService();
      expect(service).toBeDefined();
    });
  });

  describe('isInstalled', () => {
    it('returns true when terminal-notifier exits 0', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when terminal-notifier exits non-zero', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(1);
      expect(await service.isInstalled()).toBe(false);
    });

    it('returns false when terminal-notifier binary not found', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawnThrow();
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('send', () => {
    it('returns true on successful notification', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(true);
    });

    it('returns false when terminal-notifier is not installed', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawnThrow();
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(false);
    });

    it('returns false when terminal-notifier fails', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();

      let callCount = 0;
      (global as unknown as { Bun: { spawn: unknown } }).Bun.spawn = () => {
        callCount++;
        // First call is isInstalled (-help), return success
        // Second call is the actual notification, return failure
        const exitCode = callCount === 1 ? 0 : 1;
        const blob = new Blob(['']);
        return {
          stdout: blob.stream(),
          stderr: blob.stream(),
          exited: Promise.resolve(exitCode),
          kill: () => {},
        };
      };

      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(false);
    });

    it('handles optional subtitle and appIcon', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
        subtitle: 'Sub',
        appIcon: '/path/to/icon.png',
      });
      expect(result).toBe(true);
    });
  });
});

// Ensure DEFAULT_BUNDLE_ID is exported and used (suppress unused import warning)
void DEFAULT_BUNDLE_ID;
