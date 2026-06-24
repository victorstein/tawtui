/* eslint-disable @typescript-eslint/no-unsafe-return */
import { TerminalTestHelper } from '../helpers/terminal-test.helper';
import { HunkService } from '../../src/modules/hunk.service';
import { ConfigService } from '../../src/modules/config.service';

const originalBun = globalThis.Bun;

function setBunSpawn(fn: jest.Mock) {
  (globalThis as Record<string, unknown>).Bun = { spawn: fn };
}

class HunkServiceWithBundled extends HunkService {
  constructor(
    config: ConfigService,
    private readonly fakeBinPath: string | null,
  ) {
    super(config);
  }

  protected override resolveBundledBinPath(): string | null {
    return this.fakeBinPath;
  }
}

function routed(
  routes: Record<
    string,
    { stdout?: string; stderr?: string; exitCode?: number }
  >,
): jest.Mock {
  return jest.fn((cmd: string[]) => {
    const joined = cmd.join(' ');
    for (const [pattern, r] of Object.entries(routes)) {
      if (joined.includes(pattern)) {
        return TerminalTestHelper.mockSpawn(
          r.stdout ?? '',
          r.stderr ?? '',
          r.exitCode ?? 0,
        )();
      }
    }
    return TerminalTestHelper.mockSpawn('', '', 0)();
  });
}

describe('HunkService', () => {
  let svc: HunkService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new HunkService(new ConfigService());
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Bun = originalBun;
  });

  describe('isAvailable', () => {
    it('should report the hunk binary when `hunk --version` succeeds', async () => {
      setBunSpawn(
        routed({ 'hunk --version': { stdout: 'hunk 0.16.0', exitCode: 0 } }),
      );
      const result = await svc.isAvailable();
      expect(result.available).toBe(true);
      expect(result.command).toEqual(['hunk']);
    });

    it('should fall back to `bunx hunkdiff` when hunk is not on PATH', async () => {
      setBunSpawn(
        routed({
          'hunk --version': { exitCode: 127, stderr: 'not found' },
          'hunkdiff --version': { stdout: 'hunk 0.16.0', exitCode: 0 },
        }),
      );
      const result = await svc.isAvailable();
      expect(result.available).toBe(true);
      expect(result.command).toEqual(['bunx', 'hunkdiff']);
    });

    it('should report unavailable when neither resolves', async () => {
      setBunSpawn(routed({ '--version': { exitCode: 127, stderr: 'nope' } }));
      const result = await svc.isAvailable();
      expect(result.available).toBe(false);
    });

    it('should return available:false without attempting bunx when autodetect is false and no binaryPath is set', async () => {
      const spawnMock = jest.fn();
      setBunSpawn(spawnMock);
      const configSvc = new ConfigService();
      jest.spyOn(configSvc, 'getHunkConfig').mockReturnValue({
        autodetect: false,
        agentAuthorLabel: 'test',
        maxDiffBytes: 1_500_000,
      });
      const svcNoDetect = new HunkService(configSvc);

      const result = await svcNoDetect.isAvailable();

      expect(result.available).toBe(false);
      expect(result.detail).toContain('autodetect disabled');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    describe('bundled binary', () => {
      const FAKE_BIN_PATH = '/fake/node_modules/hunkdiff/bin/hunk.cjs';

      it('should prefer the bundled binary over PATH hunk when the package resolves', async () => {
        const spawnMock = routed({
          [`bun ${FAKE_BIN_PATH} --version`]: {
            stdout: 'hunk 0.16.0',
            exitCode: 0,
          },
        });
        setBunSpawn(spawnMock);
        const svcBundled = new HunkServiceWithBundled(
          new ConfigService(),
          FAKE_BIN_PATH,
        );

        const result = await svcBundled.isAvailable();

        expect(result.available).toBe(true);
        expect(result.command).toEqual(['bun', FAKE_BIN_PATH]);
      });

      it('should not probe PATH hunk at all when the bundled binary is available', async () => {
        const spawnMock = routed({
          [`bun ${FAKE_BIN_PATH} --version`]: {
            stdout: 'hunk 0.16.0',
            exitCode: 0,
          },
        });
        setBunSpawn(spawnMock);
        const svcBundled = new HunkServiceWithBundled(
          new ConfigService(),
          FAKE_BIN_PATH,
        );

        await svcBundled.isAvailable();

        const pathHunkCalls = (spawnMock.mock.calls as [string[]][]).filter(
          ([cmd]) => cmd[0] === 'hunk',
        );
        expect(pathHunkCalls).toHaveLength(0);
      });

      it('should fall back to PATH hunk when bundled resolution returns null', async () => {
        const spawnMock = routed({
          'hunk --version': { stdout: 'hunk 0.16.0', exitCode: 0 },
        });
        setBunSpawn(spawnMock);
        const svcNoBundled = new HunkServiceWithBundled(
          new ConfigService(),
          null,
        );

        const result = await svcNoBundled.isAvailable();

        expect(result.available).toBe(true);
        expect(result.command).toEqual(['hunk']);
      });

      it('should report unavailable when bundled resolution returns null and autodetect is false', async () => {
        const spawnMock = jest.fn();
        setBunSpawn(spawnMock);
        const configSvc = new ConfigService();
        jest.spyOn(configSvc, 'getHunkConfig').mockReturnValue({
          autodetect: false,
          agentAuthorLabel: 'test',
          maxDiffBytes: 1_500_000,
        });
        const svcNoBundled = new HunkServiceWithBundled(configSvc, null);

        const result = await svcNoBundled.isAvailable();

        expect(result.available).toBe(false);
        expect(spawnMock).not.toHaveBeenCalled();
      });

      it('should use binaryPath and skip bundled resolution when binaryPath is set', async () => {
        const spawnMock = routed({
          '/custom/hunk --version': { stdout: 'hunk 0.16.0', exitCode: 0 },
        });
        setBunSpawn(spawnMock);
        const configSvc = new ConfigService();
        jest.spyOn(configSvc, 'getHunkConfig').mockReturnValue({
          binaryPath: '/custom/hunk',
          autodetect: true,
          agentAuthorLabel: 'test',
          maxDiffBytes: 1_500_000,
        });
        const resolveBundledBinPathSpy = jest.spyOn(
          HunkServiceWithBundled.prototype,
          'resolveBundledBinPath' as never,
        );
        const svcCustom = new HunkServiceWithBundled(configSvc, FAKE_BIN_PATH);

        const result = await svcCustom.isAvailable();

        expect(result.available).toBe(true);
        expect(result.command).toEqual(['/custom/hunk']);
        expect(resolveBundledBinPathSpy).not.toHaveBeenCalled();
        resolveBundledBinPathSpy.mockRestore();
      });

      it('should build the foreground command using the bundled binary', async () => {
        const spawnMock = routed({
          [`bun ${FAKE_BIN_PATH} --version`]: {
            stdout: 'hunk 0.16.0',
            exitCode: 0,
          },
        });
        setBunSpawn(spawnMock);
        const svcBundled = new HunkServiceWithBundled(
          new ConfigService(),
          FAKE_BIN_PATH,
        );

        const spawned: string[][] = [];
        await svcBundled.launchForeground(
          {
            worktreePath: '/wt',
            patchPath: '/wt/pr.diff',
            agentContextPath: '/cfg/findings.json',
            port: 41005,
          },
          {
            suspend: jest.fn(),
            resume: jest.fn(),
            spawn: (cmd) => {
              spawned.push(cmd);
              return { exited: Promise.resolve(0) };
            },
          },
        );

        expect(spawned[0]).toEqual([
          'bun',
          FAKE_BIN_PATH,
          'patch',
          '/wt/pr.diff',
          '--agent-context',
          '/cfg/findings.json',
          '--agent-notes',
          '--wrap',
        ]);
      });
    });
  });

  describe('resolveSessionId', () => {
    // CONFIRMED shape (findings + manual check): `hunk session list --json` returns
    // `{ sessions: [{ sessionId, pid, cwd, sourceLabel, inputKind, fileCount, files }] }`.
    // There is NO per-session `port` field — the daemon is isolated by the HUNK_MCP_PORT env,
    // so the listing run with that env only contains this review's session(s). Match by
    // `cwd === worktreePath` for safety when more than one session is on the daemon.
    it('should return the patch session whose cwd matches the worktree', async () => {
      const listing = JSON.stringify({
        sessions: [
          { sessionId: 'sess-aaa', cwd: '/wt/pr-7-hunk', inputKind: 'patch' },
          { sessionId: 'sess-bbb', cwd: '/wt/pr-9-hunk', inputKind: 'patch' },
        ],
      });
      setBunSpawn(routed({ 'session list': { stdout: listing, exitCode: 0 } }));
      const id = await svc.resolveSessionId(41002, '/wt/pr-9-hunk');
      expect(id).toBe('sess-bbb');
    });

    it('should fall back to the only session when no worktree is given', async () => {
      const listing = JSON.stringify({
        sessions: [{ sessionId: 'sess-solo', cwd: '/wt/x' }],
      });
      setBunSpawn(routed({ 'session list': { stdout: listing, exitCode: 0 } }));
      expect(await svc.resolveSessionId(41002)).toBe('sess-solo');
    });

    it('should return null when the daemon lists no sessions', async () => {
      setBunSpawn(
        routed({ 'session list': { stdout: '{"sessions":[]}', exitCode: 0 } }),
      );
      expect(await svc.resolveSessionId(41002, '/wt/pr-9-hunk')).toBeNull();
    });
  });

  describe('launchForeground', () => {
    function fakeChild(exitCode: number) {
      return { exited: Promise.resolve(exitCode) };
    }

    it('should use defaultSpawn/defaultReset when caller omits spawn and reset', async () => {
      const spawnSpy = jest
        .spyOn(HunkService, 'defaultSpawn')
        .mockReturnValue(
          fakeChild(0) as ReturnType<typeof HunkService.defaultSpawn>,
        );
      const resetSpy = jest
        .spyOn(HunkService, 'defaultReset')
        .mockReturnValue(undefined);

      const order: string[] = [];
      const svc2 = new HunkService(new ConfigService());
      (
        svc2 as unknown as { resolveCommand: () => Promise<string[]> }
      ).resolveCommand = () => Promise.resolve(['hunk']);

      await svc2.launchForeground(
        {
          worktreePath: '/wt',
          patchPath: '/wt/pr.diff',
          agentContextPath: '/cfg/findings.json',
          port: 41005,
        },
        {
          suspend: () => order.push('suspend'),
          resume: () => order.push('resume'),
        },
      );

      expect(order).toEqual(['suspend', 'resume']);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(resetSpy).not.toHaveBeenCalled();

      spawnSpy.mockRestore();
      resetSpy.mockRestore();
    });

    it('should suspend, spawn hunk with the confirmed flags inheriting stdio, then resume', async () => {
      const order: string[] = [];
      const spawned: { cmd: string[]; opts: Record<string, unknown> }[] = [];
      const svc2 = new HunkService(new ConfigService());
      (
        svc2 as unknown as { resolveCommand: () => Promise<string[]> }
      ).resolveCommand = () => Promise.resolve(['hunk']);

      await svc2.launchForeground(
        {
          worktreePath: '/wt',
          patchPath: '/wt/pr.diff',
          agentContextPath: '/cfg/findings.json',
          port: 41005,
        },
        {
          suspend: () => order.push('suspend'),
          resume: () => order.push('resume'),
          spawn: (cmd, opts) => {
            spawned.push({ cmd, opts: opts as Record<string, unknown> });
            order.push('spawn');
            return fakeChild(0);
          },
          reset: () => order.push('reset'),
        },
      );

      expect(order).toEqual(['suspend', 'spawn', 'resume']);
      expect(spawned[0].cmd).toEqual([
        'hunk',
        'patch',
        '/wt/pr.diff',
        '--agent-context',
        '/cfg/findings.json',
        '--agent-notes',
        '--wrap',
      ]);
      expect(spawned[0].opts).toMatchObject({ cwd: '/wt', stdio: 'inherit' });
    });

    it('should run the terminal reset fallback when hunk exits non-zero', async () => {
      const order: string[] = [];
      const svc2 = new HunkService(new ConfigService());
      (
        svc2 as unknown as { resolveCommand: () => Promise<string[]> }
      ).resolveCommand = () => Promise.resolve(['hunk']);

      await svc2.launchForeground(
        {
          worktreePath: '/wt',
          patchPath: '/p',
          agentContextPath: '/c',
          port: 1,
        },
        {
          suspend: () => order.push('suspend'),
          resume: () => order.push('resume'),
          spawn: () => {
            order.push('spawn');
            return fakeChild(1);
          },
          reset: () => order.push('reset'),
        },
      );
      expect(order).toEqual(['suspend', 'spawn', 'reset', 'resume']);
    });
  });
});
