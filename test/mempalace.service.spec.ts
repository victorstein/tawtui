// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockSpawnSync = jest.fn().mockReturnValue({ exitCode: 1 });
const mockSpawn = jest.fn();

(globalThis as Record<string, unknown>).Bun = {
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
};

import { MempalaceService } from '../src/modules/slack/mempalace.service';

describe('MempalaceService', () => {
  let service: MempalaceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MempalaceService();
  });

  it('isInstalled returns a boolean', () => {
    const result = service.isInstalled();
    expect(typeof result).toBe('boolean');
  });

  it('isInstalled returns true when mempalace status exits 0', () => {
    mockSpawnSync.mockReturnValueOnce({ exitCode: 0 });
    expect(service.isInstalled()).toBe(true);
  });

  it('isInstalled returns false when mempalace status exits non-zero', () => {
    mockSpawnSync.mockReturnValueOnce({ exitCode: 1 });
    expect(service.isInstalled()).toBe(false);
  });

  it('isInstalled calls mempalace status with correct args', () => {
    service.isInstalled();
    expect(mockSpawnSync).toHaveBeenCalledWith(['mempalace', 'status'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  });

  it('mine resolves when exit code is 0', async () => {
    const mockProc = {
      exited: Promise.resolve(0),
      stderr: new ReadableStream(),
    };
    mockSpawn.mockReturnValueOnce(mockProc);

    await expect(
      service.mine('/some/dir', 'test-wing'),
    ).resolves.toBeUndefined();
  });

  it('mine calls Bun.spawn with correct args', async () => {
    const mockProc = {
      exited: Promise.resolve(0),
      stderr: new ReadableStream(),
    };
    mockSpawn.mockReturnValueOnce(mockProc);

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

  it('mine rejects when exit code is non-zero', async () => {
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

  it('mine is a function', () => {
    expect(typeof service.mine).toBe('function');
  });

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

    it('returns true when palace.db exists at palace path', () => {
      existsSyncMock.mockReturnValue(true);
      expect(service.isInitialized()).toBe(true);
    });

    it('returns false when palace.db does not exist', () => {
      existsSyncMock.mockReturnValue(false);
      expect(service.isInitialized()).toBe(false);
    });

    it('checks the correct path under ~/.local/share/tawtui/mempalace/', () => {
      existsSyncMock.mockReturnValue(false);
      service.isInitialized();
      const [[calledPath]] = existsSyncMock.mock.calls as [[string]];
      expect(calledPath).toMatch(
        /\.local\/share\/tawtui\/mempalace\/palace\.db$/,
      );
    });
  });

  describe('init', () => {
    it('runs mempalace init with the palace path', async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      };
      mockSpawn.mockReturnValueOnce(mockProc);

      await service.init('/tmp/test-palace');

      expect(mockSpawn).toHaveBeenCalledWith(
        ['mempalace', 'init', '/tmp/test-palace'],
        { stdout: 'pipe', stderr: 'pipe' },
      );
    });

    it('throws when mempalace init fails', async () => {
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

    it('resolves when mempalace init succeeds', async () => {
      mockSpawn.mockReturnValueOnce({
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      });

      await expect(service.init('/tmp/test-palace')).resolves.toBeUndefined();
    });
  });

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

    it('returns { mined: false } when staging dir does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const result = await service.mineIfNeeded('/tmp/staging', 'slack');
      expect(result).toEqual({ mined: false });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns { mined: false } when staging dir has no .json files', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue(['readme.txt', 'data.csv']);
      const result = await service.mineIfNeeded('/tmp/staging', 'slack');
      expect(result).toEqual({ mined: false });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('mines and returns { mined: true } when .json files exist', async () => {
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
  });

  describe('installPlugin', () => {
    let mkdirSyncMock: jest.SpyInstance;

    beforeEach(() => {
      const fs = jest.requireActual<typeof import('fs')>('fs');
      mkdirSyncMock = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    });

    afterEach(() => {
      mkdirSyncMock.mockRestore();
    });

    it('creates the workspace directory', async () => {
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

    it('runs claude plugin marketplace add then install with project scope', async () => {
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
        ['claude', 'plugin', 'marketplace', 'add', 'milla-jovovich/mempalace'],
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

    it('throws when plugin install fails', async () => {
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

      await expect(service.installPlugin('/tmp/workspace')).rejects.toThrow(
        /plugin install failed/,
      );
    });
  });
});
