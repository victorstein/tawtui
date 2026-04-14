/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

// ---------------------------------------------------------------------------
// Mock fs at module level so WorktreeService's direct imports get intercepted.
// Jest hoists jest.mock calls, so we use jest.requireActual inside the factory.
// Individual mock functions are declared first so tests can override them.
// ---------------------------------------------------------------------------

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockCopyFileSync = jest.fn();

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    copyFileSync: (...args: any[]) => mockCopyFileSync(...args),
  };
});

// Grab the real fs for direct file manipulation in test setup
const actualFs: typeof import('fs') = jest.requireActual('fs');

// Save original Bun global
const originalBun = globalThis.Bun;

import { WorktreeTestHelper } from '../helpers/worktree-test.helper';
import type { WorktreeStack } from '../helpers/worktree-test.helper';
import { join } from 'path';

describe('WorktreeService Integration', () => {
  let stack: WorktreeStack;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset fs mocks to pass through to real fs
    mockExistsSync.mockImplementation(
      (...args: Parameters<typeof actualFs.existsSync>) =>
        actualFs.existsSync(...args),
    );
    mockReadFileSync.mockImplementation(
      (...args: Parameters<typeof actualFs.readFileSync>) =>
        actualFs.readFileSync(...args),
    );
    mockWriteFileSync.mockImplementation(
      (...args: Parameters<typeof actualFs.writeFileSync>) =>
        actualFs.writeFileSync(...args),
    );
    mockMkdirSync.mockImplementation(
      (...args: Parameters<typeof actualFs.mkdirSync>) =>
        actualFs.mkdirSync(...args),
    );
    mockCopyFileSync.mockImplementation(
      (...args: Parameters<typeof actualFs.copyFileSync>) =>
        actualFs.copyFileSync(...args),
    );
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Bun = originalBun;
    if (stack) {
      stack.cleanup();
    }
  });

  // ================================================================
  // Race Conditions (WT-RC)
  // ================================================================
  describe('Race Conditions', () => {
    // WT-RC-1: Concurrent ensureClone shares promise
    it('should share a single clone promise for concurrent ensureClone calls', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': { stdout: '', stderr: '', exitCode: 0, delayMs: 100 },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      const [result1, result2] = await Promise.all([
        stack.service.ensureClone('owner', 'repo'),
        stack.service.ensureClone('owner', 'repo'),
      ]);

      // Both should return the same clonePath
      expect(result1.clonePath).toBe(result2.clonePath);

      // spawn should have been called with 'repo clone' only once
      const cloneCalls = mockSpawn.mock.calls.filter((call: any[]) =>
        call[0].join(' ').includes('repo clone'),
      );
      expect(cloneCalls).toHaveLength(1);
    });

    // WT-RC-2: Shared ensureClone promise rejects, cloneInFlight cleared
    it('should clear cloneInFlight when shared promise rejects and allow retry', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': {
          stdout: '',
          stderr: 'clone failed',
          exitCode: 1,
          delayMs: 50,
        },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      // Both should reject
      const results = await Promise.allSettled([
        stack.service.ensureClone('owner', 'repo'),
        stack.service.ensureClone('owner', 'repo'),
      ]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');

      // cloneInFlight should be empty
      expect((stack.service as any).cloneInFlight.size).toBe(0);

      // Change mock to succeed, retry should trigger a fresh clone
      mockSpawn.mockImplementation((cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('repo clone')) {
          return WorktreeTestHelper.routedSpawn({
            'repo clone': { exitCode: 0 },
          })(cmd);
        }
        return WorktreeTestHelper.routedSpawn({})(cmd);
      });

      const result = await stack.service.ensureClone('owner', 'repo');
      expect(result.clonePath).toBeDefined();
    });

    // WT-RC-3: Concurrent createWorktree for same PR
    it('should handle concurrent createWorktree calls for the same PR', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': { exitCode: 0 },
        'fetch origin': { exitCode: 0 },
        'worktree add': { exitCode: 0 },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      // Both calls race — the first to call findByPr gets undefined,
      // both proceed to ensureClone. The first to set worktrees.set wins;
      // the second will either return the first's result via findByPr
      // or also succeed depending on timing.
      const results = await Promise.allSettled([
        stack.service.createWorktree('o', 'r', 1),
        stack.service.createWorktree('o', 'r', 1),
      ]);

      // At least one should succeed
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Only one worktree entry should exist in the map (same id)
      expect(stack.service.listWorktrees()).toHaveLength(1);
      expect(stack.service.listWorktrees()[0].id).toBe('o/r#pr-1');
    });
  });

  // ================================================================
  // Boundary Corruption (WT-BC)
  // ================================================================
  describe('Boundary Corruption', () => {
    // WT-BC-1: Empty repos.json
    it('should handle empty repos.json gracefully', () => {
      (globalThis as Record<string, unknown>).Bun = { spawn: jest.fn() };
      stack = WorktreeTestHelper.createStack();

      actualFs.writeFileSync(stack.reposJsonPath, '', 'utf-8');

      (stack.service as any).loadPersistedRepos();

      expect((stack.service as any).repos.size).toBe(0);
    });

    // WT-BC-2: Truncated worktrees.json
    it('should handle truncated worktrees.json gracefully', () => {
      (globalThis as Record<string, unknown>).Bun = { spawn: jest.fn() };
      stack = WorktreeTestHelper.createStack();

      actualFs.writeFileSync(
        stack.worktreesJsonPath,
        '[{"id":"test"',
        'utf-8',
      );

      (stack.service as any).loadPersistedWorktrees();

      expect((stack.service as any).worktrees.size).toBe(0);
    });

    // WT-BC-3: Invalid date strings in persisted data
    it('should trigger fetch when persisted dates are invalid NaN strings', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'fetch origin': { exitCode: 0 },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      actualFs.writeFileSync(
        stack.reposJsonPath,
        JSON.stringify([
          {
            owner: 'o',
            repo: 'r',
            clonePath: '/tmp/x',
            clonedAt: 'not-a-date',
            lastFetchedAt: 'garbage',
          },
        ]),
        'utf-8',
      );

      (stack.service as any).loadPersistedRepos();

      // Repo should be loaded
      expect((stack.service as any).repos.size).toBe(1);

      const repo = (stack.service as any).repos.get('o/r');
      expect(repo).toBeDefined();

      // lastFetchedAt parsed as NaN date
      expect(repo.lastFetchedAt.getTime()).toBeNaN();

      // Staleness check: Date.now() - NaN < FETCH_STALE_MS => NaN < 300000 => false
      // So ensureClone should trigger a fetch
      await stack.service.ensureClone('o', 'r');

      const fetchCalls = mockSpawn.mock.calls.filter((call: any[]) =>
        call[0].join(' ').includes('fetch origin'),
      );
      expect(fetchCalls).toHaveLength(1);
    });

    // WT-BC-4: persistWorktrees fails silently
    it('should succeed with in-memory state intact when persistWorktrees fails', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': { exitCode: 0 },
        'fetch origin': { exitCode: 0 },
        'worktree add': { exitCode: 0 },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      // Make writeFileSync throw only for worktrees.json
      mockWriteFileSync.mockImplementation(
        (path: string, ...args: any[]) => {
          if (String(path).includes('worktrees.json')) {
            throw new Error('EPERM');
          }
          return (actualFs.writeFileSync as any)(path, ...args);
        },
      );

      const result = await stack.service.createWorktree('o', 'r', 1);

      expect(result.status).toBe('active');
      expect(stack.service.listWorktrees()).toHaveLength(1);
    });
  });

  // ================================================================
  // Failure Cascades (WT-FC)
  // ================================================================
  describe('Failure Cascades', () => {
    // WT-FC-1: Worktree add fails after fetch succeeds
    it('should roll back worktree map entry when git worktree add fails', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': { exitCode: 0 },
        'fetch origin': { exitCode: 0 },
        'worktree add': {
          exitCode: 1,
          stderr: 'already exists',
        },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      await expect(
        stack.service.createWorktree('o', 'r', 1),
      ).rejects.toThrow('Failed to create worktree');

      expect(stack.service.listWorktrees()).toHaveLength(0);
    });

    // WT-FC-2: Setup script fails, worktree still active
    it('should return active worktree when setup script fails', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'repo clone': { exitCode: 0 },
        'fetch origin': { exitCode: 0 },
        'worktree add': { exitCode: 0 },
        'bash .worktree-setup.sh': { exitCode: 1, stderr: 'setup failed' },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      // The worktree path where the service will look for the setup script
      const worktreePath = join(
        stack.baseDir,
        'o',
        'r-worktrees',
        'pr-1',
      );
      actualFs.mkdirSync(worktreePath, { recursive: true });
      actualFs.writeFileSync(
        join(worktreePath, '.worktree-setup.sh'),
        '#!/bin/bash\nexit 1',
        'utf-8',
      );

      const result = await stack.service.createWorktree('o', 'r', 1);

      expect(result.status).toBe('active');
      expect(stack.service.listWorktrees()).toHaveLength(1);
    });

    // WT-FC-3: removeWorktree on non-existent id
    it('should throw when removing a worktree that does not exist', async () => {
      (globalThis as Record<string, unknown>).Bun = { spawn: jest.fn() };
      stack = WorktreeTestHelper.createStack();

      await expect(
        stack.service.removeWorktree('nonexistent'),
      ).rejects.toThrow('Worktree not found: nonexistent');
    });

    // WT-FC-4: Partial cleanup on removeWorktree
    it('should remove worktree from map even when git worktree remove fails', async () => {
      const mockSpawn = WorktreeTestHelper.routedSpawn({
        'worktree remove': { exitCode: 1, stderr: 'not a valid directory' },
        'branch -D': { exitCode: 0 },
        'worktree prune': { exitCode: 0 },
      });
      (globalThis as Record<string, unknown>).Bun = { spawn: mockSpawn };

      stack = WorktreeTestHelper.createStack();

      // Add a worktree directly to the map
      const id = 'owner/repo#pr-42';
      const info = WorktreeTestHelper.worktreeInfo({
        id,
        path: '/tmp/test-worktree-42',
        branch: 'tawtui/pr-42',
        prNumber: 42,
        repoOwner: 'owner',
        repoName: 'repo',
        clonePath: '/tmp/test-clone',
        status: 'active',
      });
      (stack.service as any).worktrees.set(id, info);

      await stack.service.removeWorktree(id);

      expect(stack.service.listWorktrees()).toHaveLength(0);
    });
  });

  // ================================================================
  // Orphan Detection (WT-OD)
  // ================================================================
  describe('Orphan Detection', () => {
    // WT-OD-1: Orphaned worktree detection
    it('should mark worktree as orphaned when its path does not exist', () => {
      (globalThis as Record<string, unknown>).Bun = { spawn: jest.fn() };

      stack = WorktreeTestHelper.createStack();

      const nonExistentPath = '/tmp/nonexistent-path-xyz-' + Date.now();

      actualFs.writeFileSync(
        stack.worktreesJsonPath,
        JSON.stringify([
          {
            id: 'owner/repo#pr-99',
            path: nonExistentPath,
            branch: 'tawtui/pr-99',
            prNumber: 99,
            repoOwner: 'owner',
            repoName: 'repo',
            clonePath: '/tmp/test-clone',
            createdAt: new Date().toISOString(),
            status: 'active',
          },
        ]),
        'utf-8',
      );

      (stack.service as any).loadPersistedWorktrees();
      (stack.service as any).detectOrphans();

      const worktree = (stack.service as any).worktrees.get(
        'owner/repo#pr-99',
      );
      expect(worktree).toBeDefined();
      expect(worktree.status).toBe('orphaned');
    });
  });
});
