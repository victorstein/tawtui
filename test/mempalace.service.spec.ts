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
});
