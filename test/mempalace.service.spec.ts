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
    expect(mockSpawnSync).toHaveBeenCalledWith(
      ['python3', '-m', 'mempalace', 'status'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
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
        'python3',
        '-m',
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
});
