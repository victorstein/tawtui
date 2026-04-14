import { WorktreeService } from '../../src/modules/worktree.service';
import { TerminalTestHelper } from './terminal-test.helper';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  ManagedRepo,
  WorktreeInfo,
} from '../../src/modules/worktree.types';

export interface WorktreeStack {
  service: WorktreeService;
  baseDir: string;
  reposJsonPath: string;
  worktreesJsonPath: string;
  tmpDir: string;
  cleanup: () => void;
}

export class WorktreeTestHelper {
  /**
   * Create a WorktreeService with temp dirs for all persistent state.
   * Mock Bun.spawn globally BEFORE calling this.
   */
  static createStack(): WorktreeStack {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-worktree-test-'));
    const baseDir = join(tmpDir, 'repos');
    mkdirSync(baseDir, { recursive: true });

    const reposJsonPath = join(tmpDir, 'repos.json');
    const worktreesJsonPath = join(tmpDir, 'worktrees.json');

    const service = new WorktreeService();
    (service as any).baseDir = baseDir;
    (service as any).reposJsonPath = reposJsonPath;
    (service as any).worktreesJsonPath = worktreesJsonPath;

    return {
      service,
      baseDir,
      reposJsonPath,
      worktreesJsonPath,
      tmpDir,
      cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
    };
  }

  /** Create a ManagedRepo object with defaults. */
  static managedRepo(overrides: Partial<ManagedRepo> = {}): ManagedRepo {
    return {
      owner: overrides.owner ?? 'testowner',
      repo: overrides.repo ?? 'testrepo',
      clonePath: overrides.clonePath ?? '/tmp/test-clone',
      clonedAt: overrides.clonedAt ?? new Date(),
      lastFetchedAt: overrides.lastFetchedAt ?? new Date(),
    };
  }

  /** Create a WorktreeInfo object with defaults. */
  static worktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
    return {
      id: overrides.id ?? 'testowner/testrepo#pr-1',
      path: overrides.path ?? '/tmp/test-worktree',
      branch: overrides.branch ?? 'tawtui/pr-1',
      prNumber: overrides.prNumber ?? 1,
      repoOwner: overrides.repoOwner ?? 'testowner',
      repoName: overrides.repoName ?? 'testrepo',
      clonePath: overrides.clonePath ?? '/tmp/test-clone',
      createdAt: overrides.createdAt ?? new Date(),
      status: overrides.status ?? 'active',
    };
  }

  /**
   * Create a routed async Bun.spawn mock.
   * Routes are matched by checking if the command args contain the pattern.
   * Supports optional delays per route for concurrency tests.
   */
  static routedSpawn(
    routes: Record<
      string,
      {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        delayMs?: number;
      }
    >,
  ): jest.Mock {
    return jest.fn((cmd: string[]) => {
      const joined = cmd.join(' ');
      for (const [pattern, config] of Object.entries(routes)) {
        if (joined.includes(pattern)) {
          const result = TerminalTestHelper.mockSpawn(
            config.stdout ?? '',
            config.stderr ?? '',
            config.exitCode ?? 0,
          )();
          if (config.delayMs) {
            return {
              ...result,
              exited: new Promise<number>((resolve) =>
                setTimeout(
                  () => resolve(config.exitCode ?? 0),
                  config.delayMs,
                ),
              ),
            };
          }
          return result;
        }
      }
      return TerminalTestHelper.mockSpawn('', '', 0)();
    });
  }
}
