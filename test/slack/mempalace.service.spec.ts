// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockSpawnSync = jest.fn().mockReturnValue({ exitCode: 1 });
const mockSpawn = jest.fn();

(globalThis as Record<string, unknown>).Bun = {
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
};

import { MempalaceService } from '../../src/modules/slack/mempalace.service';
import { TerminalTestHelper } from '../helpers/terminal-test.helper';

describe('MempalaceService', () => {
  let service: MempalaceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MempalaceService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── isInstalled ──────────────────────────────────────────────────────────

  describe('isInstalled', () => {
    describe('Behavior', () => {
      it('should return true when mempalace status exits 0', () => {
        mockSpawnSync.mockReturnValueOnce(
          TerminalTestHelper.spawnSyncResult('', '', 0),
        );
        expect(service.isInstalled()).toBe(true);
      });

      it('should return false when mempalace status exits non-zero', () => {
        mockSpawnSync.mockReturnValueOnce(
          TerminalTestHelper.spawnSyncResult('', 'not found', 1),
        );
        expect(service.isInstalled()).toBe(false);
      });

      it('should call spawnSync with correct args', () => {
        mockSpawnSync.mockReturnValueOnce(
          TerminalTestHelper.spawnSyncResult('', '', 0),
        );
        service.isInstalled();
        expect(mockSpawnSync).toHaveBeenCalledWith(['mempalace', 'status'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
      });

      it('should return a boolean', () => {
        mockSpawnSync.mockReturnValueOnce(
          TerminalTestHelper.spawnSyncResult('', '', 0),
        );
        expect(typeof service.isInstalled()).toBe('boolean');
      });
    });
  });

  // ─── isInitialized ────────────────────────────────────────────────────────

  describe('isInitialized', () => {
    let existsSyncMock: jest.SpyInstance;

    beforeEach(() => {
      existsSyncMock = jest.spyOn(
        jest.requireActual<typeof import('fs')>('fs'),
        'existsSync',
      );
    });

    afterEach(() => {
      existsSyncMock.mockRestore();
    });

    describe('Behavior', () => {
      it('should return true when palace path exists', () => {
        existsSyncMock.mockReturnValue(true);
        expect(service.isInitialized()).toBe(true);
      });

      it('should return false when path missing', () => {
        existsSyncMock.mockReturnValue(false);
        expect(service.isInitialized()).toBe(false);
      });

      it('should check mempalace.yaml under ~/.local/share/tawtui/mempalace/', () => {
        existsSyncMock.mockReturnValue(false);
        service.isInitialized();
        const [[calledPath]] = existsSyncMock.mock.calls as [[string]];
        expect(calledPath).toMatch(
          /\.local\/share\/tawtui\/mempalace\/mempalace\.yaml$/,
        );
      });
    });
  });

  // ─── init ─────────────────────────────────────────────────────────────────

  describe('init', () => {
    let mkdirSyncMock: jest.SpyInstance;

    beforeEach(() => {
      mkdirSyncMock = jest
        .spyOn(jest.requireActual<typeof import('fs')>('fs'), 'mkdirSync')
        .mockReturnValue(undefined);
    });

    afterEach(() => {
      mkdirSyncMock.mockRestore();
    });

    describe('Behavior', () => {
      it('should run mempalace init with palace path', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });

        await service.init('/tmp/test-palace');

        expect(mkdirSyncMock).toHaveBeenCalledWith('/tmp/test-palace', {
          recursive: true,
        });
        expect(mockSpawn).toHaveBeenCalledWith(
          ['mempalace', 'init', '/tmp/test-palace'],
          expect.objectContaining({
            stdout: 'pipe',
            stderr: 'pipe',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            stdin: expect.any(Blob),
          }),
        );
      });

      it('should resolve when mempalace init succeeds', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });

        await expect(service.init('/tmp/test-palace')).resolves.toBeUndefined();
      });
    });

    describe('Error Handling', () => {
      it('should reject on non-zero exit', async () => {
        const errorStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('init failed'));
            controller.close();
          },
        });
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(1),
          stdout: new ReadableStream(),
          stderr: errorStream,
        });

        await expect(service.init('/tmp/test-palace')).rejects.toThrow(
          /mempalace init failed/,
        );
      });
    });
  });

  // ─── mine ─────────────────────────────────────────────────────────────────

  describe('mine', () => {
    describe('Behavior', () => {
      it('should run mempalace mine with dir and wing args', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        });

        await service.mine('/some/dir', 'test-wing');

        expect(mockSpawn).toHaveBeenCalledWith(
          [
            'mempalace',
            'mine',
            '/some/dir',
            '--mode',
            'convos',
            '--wing',
            'test-wing',
          ],
          { stdout: 'pipe', stderr: 'pipe' },
        );
      });

      it('should resolve when exit code is 0', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        });

        await expect(
          service.mine('/some/dir', 'test-wing'),
        ).resolves.toBeUndefined();
      });
    });

    describe('Error Handling', () => {
      it('should reject on non-zero exit with stderr', async () => {
        const stderrText = 'some error output';
        const mockProc = {
          exited: Promise.resolve(1),
          stderr: new Response(stderrText).body,
        };
        mockSpawn.mockReturnValueOnce(mockProc);

        await expect(
          service.mine('/nonexistent/path/xyzzy', 'test'),
        ).rejects.toThrow(/mempalace mine failed/);
      });
    });
  });

  // ─── mineIfNeeded ─────────────────────────────────────────────────────────

  describe('mineIfNeeded', () => {
    let existsSyncMock: jest.SpyInstance;
    let readdirSyncMock: jest.SpyInstance;

    beforeEach(() => {
      const fs = jest.requireActual<typeof import('fs')>('fs');
      existsSyncMock = jest.spyOn(fs, 'existsSync');
      readdirSyncMock = jest.spyOn(fs, 'readdirSync');
    });

    afterEach(() => {
      existsSyncMock.mockRestore();
      readdirSyncMock.mockRestore();
    });

    describe('Behavior', () => {
      it('should skip mine when staging dir is empty', async () => {
        existsSyncMock.mockReturnValue(true);
        readdirSyncMock.mockReturnValue([]);
        const result = await service.mineIfNeeded('/tmp/staging', 'slack');
        expect(result).toEqual({ mined: false });
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('should mine when staging dir has .json files', async () => {
        existsSyncMock.mockReturnValue(true);
        readdirSyncMock.mockReturnValue(['channel1.json', 'channel2.json']);
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        });

        const result = await service.mineIfNeeded('/tmp/staging', 'slack');

        expect(result).toEqual({ mined: true });
        expect(mockSpawn).toHaveBeenCalledWith(
          [
            'mempalace',
            'mine',
            '/tmp/staging',
            '--mode',
            'convos',
            '--wing',
            'slack',
          ],
          { stdout: 'pipe', stderr: 'pipe' },
        );
      });

      it('should return { mined: false } when staging dir does not exist', async () => {
        existsSyncMock.mockReturnValue(false);
        const result = await service.mineIfNeeded('/tmp/staging', 'slack');
        expect(result).toEqual({ mined: false });
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should ignore non-json files in staging dir', async () => {
        existsSyncMock.mockReturnValue(true);
        readdirSyncMock.mockReturnValue(['readme.txt', 'data.csv', '.DS_Store']);
        const result = await service.mineIfNeeded('/tmp/staging', 'slack');
        expect(result).toEqual({ mined: false });
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('should mine when dir has mixed json and non-json files', async () => {
        existsSyncMock.mockReturnValue(true);
        readdirSyncMock.mockReturnValue([
          'readme.txt',
          'channel1.json',
          'data.csv',
        ]);
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        });

        const result = await service.mineIfNeeded('/tmp/staging', 'slack');

        expect(result).toEqual({ mined: true });
        expect(mockSpawn).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ─── installPlugin ────────────────────────────────────────────────────────

  describe('installPlugin', () => {
    let mkdirSyncMock: jest.SpyInstance;

    beforeEach(() => {
      mkdirSyncMock = jest
        .spyOn(jest.requireActual<typeof import('fs')>('fs'), 'mkdirSync')
        .mockReturnValue(undefined);
    });

    afterEach(() => {
      mkdirSyncMock.mockRestore();
    });

    describe('Behavior', () => {
      it('should run marketplace add + project install', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });

        await service.installPlugin('/tmp/workspace');

        expect(mockSpawn).toHaveBeenCalledWith(
          [
            'claude',
            'plugin',
            'marketplace',
            'add',
            'milla-jovovich/mempalace',
          ],
          expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
        );
        expect(mockSpawn).toHaveBeenCalledWith(
          ['claude', 'plugin', 'install', '--scope', 'project', 'mempalace'],
          expect.objectContaining({
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: '/tmp/workspace',
          }),
        );
      });

      it('should create the workspace directory', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });

        await service.installPlugin('/tmp/workspace');

        expect(mkdirSyncMock).toHaveBeenCalledWith('/tmp/workspace', {
          recursive: true,
        });
      });
    });

    describe('Error Handling', () => {
      it('should reject on spawn failure during install', async () => {
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });
        const errorStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('install error'));
            controller.close();
          },
        });
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(1),
          stdout: new ReadableStream(),
          stderr: errorStream,
        });

        await expect(
          service.installPlugin('/tmp/workspace'),
        ).rejects.toThrow(/plugin install failed/);
      });

      it('should succeed even when marketplace add returns non-zero', async () => {
        // marketplace add is idempotent — exit code ignored
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(1),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });
        mockSpawn.mockReturnValueOnce({
          exited: Promise.resolve(0),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
        });

        await expect(
          service.installPlugin('/tmp/workspace'),
        ).resolves.toBeUndefined();
      });
    });
  });

  // ─── reset ────────────────────────────────────────────────────────────────

  describe('reset', () => {
    let rmSyncMock: jest.SpyInstance;

    beforeEach(() => {
      rmSyncMock = jest
        .spyOn(jest.requireActual<typeof import('fs')>('fs'), 'rmSync')
        .mockReturnValue(undefined);
    });

    afterEach(() => {
      rmSyncMock.mockRestore();
    });

    describe('Behavior', () => {
      it('should remove palace and staging directories', () => {
        service.reset();

        expect(rmSyncMock).toHaveBeenCalledTimes(2);
        const calls = rmSyncMock.mock.calls as [string, object][];
        expect(calls[0][0]).toMatch(/\.local\/share\/tawtui\/mempalace$/);
        expect(calls[1][0]).toMatch(/\.mempalace\/palace$/);
      });

      it('should use recursive + force flags', () => {
        service.reset();

        const calls = rmSyncMock.mock.calls as [string, object][];
        for (const [, opts] of calls) {
          expect(opts).toEqual({ recursive: true, force: true });
        }
      });
    });

    describe('Edge Cases', () => {
      it('should handle missing directories gracefully via force flag', () => {
        // rmSync with { force: true } does not throw on missing paths
        rmSyncMock.mockReturnValue(undefined);
        expect(() => service.reset()).not.toThrow();
      });
    });
  });
});
