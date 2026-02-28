import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ExecResult } from '../shared/types';
import type { ManagedRepo, WorktreeInfo } from './worktree.types';

/** Staleness threshold for clone fetches (5 minutes). */
const FETCH_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class WorktreeService implements OnModuleInit {
  private readonly logger = new Logger(WorktreeService.name);

  private readonly baseDir = join(
    homedir(),
    '.local',
    'share',
    'tawtui',
    'repos',
  );

  private readonly reposJsonPath = join(
    homedir(),
    '.local',
    'share',
    'tawtui',
    'repos.json',
  );

  private readonly worktreesJsonPath = join(
    homedir(),
    '.local',
    'share',
    'tawtui',
    'worktrees.json',
  );

  /** Managed clones keyed by "{owner}/{repo}". */
  private readonly repos = new Map<string, ManagedRepo>();

  /** Active worktrees keyed by their id ("{owner}/{repo}#pr-{number}"). */
  private readonly worktrees = new Map<string, WorktreeInfo>();

  /** In-flight clone/fetch promises to prevent concurrent duplicates. */
  private readonly cloneInFlight = new Map<string, Promise<ManagedRepo>>();

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onModuleInit(): void {
    mkdirSync(this.baseDir, { recursive: true });
    this.loadPersistedRepos();
    this.loadPersistedWorktrees();
    this.detectOrphans();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Ensure a shallow clone of the given repository exists and is fresh.
   * Returns immediately if the clone was fetched within the last 5 minutes.
   * Concurrent calls for the same repo share a single in-flight promise.
   */
  async ensureClone(owner: string, repo: string): Promise<ManagedRepo> {
    const key = `${owner}/${repo}`;

    // Return the in-flight promise if one exists (prevents duplicate clones).
    const inflight = this.cloneInFlight.get(key);
    if (inflight) {
      return inflight;
    }

    const promise = this.doEnsureClone(owner, repo);
    this.cloneInFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.cloneInFlight.delete(key);
    }
  }

  /**
   * Create (or return an existing) worktree for a pull request.
   * The clone is ensured, the PR ref is fetched, and a git worktree is
   * created at `{baseDir}/{owner}/{repo}-worktrees/pr-{prNumber}`.
   */
  async createWorktree(
    owner: string,
    repo: string,
    prNumber: number,
    envFiles?: string[],
  ): Promise<WorktreeInfo> {
    const existing = this.findByPr(owner, repo, prNumber);
    if (existing) {
      return existing;
    }

    const managed = await this.ensureClone(owner, repo);
    const id = `${owner}/${repo}#pr-${prNumber}`;
    const branch = `tawtui/pr-${prNumber}`;
    const worktreePath = join(
      this.baseDir,
      owner,
      `${repo}-worktrees`,
      `pr-${prNumber}`,
    );

    const info: WorktreeInfo = {
      id,
      path: worktreePath,
      branch,
      prNumber,
      repoOwner: owner,
      repoName: repo,
      clonePath: managed.clonePath,
      createdAt: new Date(),
      status: 'creating',
    };

    this.worktrees.set(id, info);
    this.persistWorktrees();

    try {
      // Fetch the PR ref into a local branch.
      const fetchResult = await this.execGit(
        ['fetch', 'origin', `pull/${prNumber}/head:${branch}`, '--force'],
        managed.clonePath,
      );

      if (fetchResult.exitCode !== 0) {
        throw new Error(
          `Failed to fetch PR ref (exit ${fetchResult.exitCode}): ${fetchResult.stderr.trim()}`,
        );
      }

      // Create the worktree directory's parent.
      mkdirSync(join(this.baseDir, owner, `${repo}-worktrees`), {
        recursive: true,
      });

      // Create the git worktree.
      const addResult = await this.execGit(
        ['worktree', 'add', worktreePath, branch],
        managed.clonePath,
      );

      if (addResult.exitCode !== 0) {
        throw new Error(
          `Failed to create worktree (exit ${addResult.exitCode}): ${addResult.stderr.trim()}`,
        );
      }

      // Copy env files from clone root to worktree root if they exist.
      if (envFiles?.length) {
        for (const envFile of envFiles) {
          const src = join(managed.clonePath, envFile);
          if (existsSync(src)) {
            copyFileSync(src, join(worktreePath, envFile));
            this.logger.debug(`Copied env file ${envFile} to worktree`);
          }
        }
      }

      // Run .worktree-setup.sh if it exists in the worktree.
      const setupScript = join(worktreePath, '.worktree-setup.sh');
      if (existsSync(setupScript)) {
        this.logger.log(`Running .worktree-setup.sh in ${worktreePath}`);
        const setupResult = await this.execInDir(
          ['bash', '.worktree-setup.sh'],
          worktreePath,
        );
        if (setupResult.exitCode !== 0) {
          this.logger.warn(
            `.worktree-setup.sh exited with code ${setupResult.exitCode}: ${setupResult.stderr.trim()}`,
          );
        }
      }

      info.status = 'active';
      this.persistWorktrees();
      this.logger.log(`Created worktree ${id} at ${worktreePath}`);

      return info;
    } catch (error) {
      // Roll back on failure.
      this.worktrees.delete(id);
      this.persistWorktrees();
      throw error;
    }
  }

  /**
   * Remove a worktree by its id and clean up the local branch.
   */
  async removeWorktree(id: string): Promise<void> {
    const info = this.worktrees.get(id);
    if (!info) {
      throw new Error(`Worktree not found: ${id}`);
    }

    info.status = 'removing';
    this.persistWorktrees();

    // Force-remove the worktree.
    const removeResult = await this.execGit(
      ['worktree', 'remove', info.path, '--force'],
      info.clonePath,
    );

    if (removeResult.exitCode !== 0) {
      this.logger.warn(
        `Failed to remove worktree (exit ${removeResult.exitCode}): ${removeResult.stderr.trim()}`,
      );
    }

    // Delete the local branch.
    const branchResult = await this.execGit(
      ['branch', '-D', info.branch],
      info.clonePath,
    );

    if (branchResult.exitCode !== 0) {
      this.logger.warn(
        `Failed to delete branch ${info.branch} (exit ${branchResult.exitCode}): ${branchResult.stderr.trim()}`,
      );
    }

    // Prune stale worktree bookkeeping.
    await this.execGit(['worktree', 'prune'], info.clonePath);

    this.worktrees.delete(id);
    this.persistWorktrees();
    this.logger.log(`Removed worktree ${id}`);
  }

  /**
   * Find a worktree associated with a specific PR.
   */
  findByPr(
    owner: string,
    repo: string,
    prNumber: number,
  ): WorktreeInfo | undefined {
    const id = `${owner}/${repo}#pr-${prNumber}`;
    return this.worktrees.get(id);
  }

  /**
   * Link a terminal session to a worktree.
   */
  linkSession(worktreeId: string, sessionId: string): void {
    const info = this.worktrees.get(worktreeId);
    if (!info) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    info.sessionId = sessionId;
    this.persistWorktrees();
  }

  /**
   * Return all tracked worktrees.
   */
  listWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /**
   * Retrieve a single worktree by its id.
   */
  getWorktree(id: string): WorktreeInfo | undefined {
    return this.worktrees.get(id);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async doEnsureClone(
    owner: string,
    repo: string,
  ): Promise<ManagedRepo> {
    const key = `${owner}/${repo}`;
    const clonePath = join(this.baseDir, owner, repo);
    const existing = this.repos.get(key);

    if (existing) {
      const now = Date.now();
      const lastFetch = existing.lastFetchedAt?.getTime() ?? 0;

      if (now - lastFetch < FETCH_STALE_MS) {
        this.logger.debug(`Clone ${key} is fresh, skipping fetch`);
        return existing;
      }

      // Clone exists but is stale — fetch latest.
      this.logger.log(`Fetching origin for ${key}`);
      const fetchResult = await this.execGit(
        ['fetch', 'origin'],
        existing.clonePath,
      );

      if (fetchResult.exitCode !== 0) {
        this.logger.warn(
          `git fetch failed for ${key} (exit ${fetchResult.exitCode}): ${fetchResult.stderr.trim()}`,
        );
      }

      existing.lastFetchedAt = new Date();
      this.persistRepos();
      return existing;
    }

    // Not cloned yet — perform a blobless clone.
    this.logger.log(`Cloning ${owner}/${repo} into ${clonePath}`);
    mkdirSync(join(this.baseDir, owner), { recursive: true });

    const cloneResult = await this.execGh([
      'repo',
      'clone',
      `${owner}/${repo}`,
      clonePath,
      '--',
      '--filter=blob:none',
    ]);

    if (cloneResult.exitCode !== 0) {
      throw new Error(
        `Failed to clone ${owner}/${repo} (exit ${cloneResult.exitCode}): ${cloneResult.stderr.trim()}`,
      );
    }

    const managed: ManagedRepo = {
      owner,
      repo,
      clonePath,
      clonedAt: new Date(),
      lastFetchedAt: new Date(),
    };

    this.repos.set(key, managed);
    this.persistRepos();
    this.logger.log(`Cloned ${key} to ${clonePath}`);

    return managed;
  }

  /**
   * Detect orphaned worktrees whose paths no longer exist on disk.
   */
  private detectOrphans(): void {
    let orphanCount = 0;

    for (const info of this.worktrees.values()) {
      if (info.status === 'removing') continue;

      if (!existsSync(info.path)) {
        info.status = 'orphaned';
        orphanCount++;
      }
    }

    if (orphanCount > 0) {
      this.logger.warn(`Detected ${orphanCount} orphaned worktree(s)`);
      this.persistWorktrees();
    }
  }

  /**
   * Execute a git command via Bun.spawn.
   */
  private async execGit(args: string[], cwd: string): Promise<ExecResult> {
    const cmd = ['git', ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')} (cwd: ${cwd})`);

    try {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.warn(
          `git exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
        );
      }

      return { stdout, stderr, exitCode };
    } catch {
      return {
        stdout: '',
        stderr: 'git binary not found',
        exitCode: 1,
      };
    }
  }

  /**
   * Execute a gh CLI command via Bun.spawn.
   */
  private async execGh(args: string[]): Promise<ExecResult> {
    const cmd = ['gh', ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')}`);

    try {
      const proc = Bun.spawn(cmd, {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.warn(
          `gh exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
        );
      }

      return { stdout, stderr, exitCode };
    } catch {
      return {
        stdout: '',
        stderr: 'gh binary not found',
        exitCode: 1,
      };
    }
  }

  /**
   * Execute an arbitrary command in a directory via Bun.spawn.
   */
  private async execInDir(cmd: string[], cwd: string): Promise<ExecResult> {
    this.logger.debug(`Executing: ${cmd.join(' ')} (cwd: ${cwd})`);

    try {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return { stdout, stderr, exitCode };
    } catch {
      return {
        stdout: '',
        stderr: `Failed to execute: ${cmd.join(' ')}`,
        exitCode: 1,
      };
    }
  }

  /** Persist managed repo metadata to repos.json. */
  private persistRepos(): void {
    try {
      const dir = join(homedir(), '.local', 'share', 'tawtui');
      mkdirSync(dir, { recursive: true });

      const data = Array.from(this.repos.values()).map((r) => ({
        owner: r.owner,
        repo: r.repo,
        clonePath: r.clonePath,
        clonedAt: r.clonedAt.toISOString(),
        lastFetchedAt: r.lastFetchedAt?.toISOString(),
      }));

      writeFileSync(this.reposJsonPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      this.logger.warn('Failed to persist repo metadata');
    }
  }

  /** Load persisted repo metadata from repos.json. */
  private loadPersistedRepos(): void {
    try {
      if (!existsSync(this.reposJsonPath)) return;

      const text = readFileSync(this.reposJsonPath, 'utf-8');
      const data = JSON.parse(text) as Array<Record<string, unknown>>;

      for (const item of data) {
        const owner = item.owner as string;
        const repo = item.repo as string;
        const key = `${owner}/${repo}`;

        this.repos.set(key, {
          owner,
          repo,
          clonePath: item.clonePath as string,
          clonedAt: new Date(item.clonedAt as string),
          lastFetchedAt: item.lastFetchedAt
            ? new Date(item.lastFetchedAt as string)
            : undefined,
        });
      }

      this.logger.log(`Loaded ${this.repos.size} persisted repo(s)`);
    } catch {
      this.logger.warn('Failed to load persisted repo metadata');
    }
  }

  /** Persist worktree metadata to worktrees.json. */
  private persistWorktrees(): void {
    try {
      const dir = join(homedir(), '.local', 'share', 'tawtui');
      mkdirSync(dir, { recursive: true });

      const data = Array.from(this.worktrees.values()).map((w) => ({
        id: w.id,
        path: w.path,
        branch: w.branch,
        prNumber: w.prNumber,
        repoOwner: w.repoOwner,
        repoName: w.repoName,
        clonePath: w.clonePath,
        sessionId: w.sessionId,
        createdAt: w.createdAt.toISOString(),
        status: w.status,
      }));

      writeFileSync(
        this.worktreesJsonPath,
        JSON.stringify(data, null, 2),
        'utf-8',
      );
    } catch {
      this.logger.warn('Failed to persist worktree metadata');
    }
  }

  /** Load persisted worktree metadata from worktrees.json. */
  private loadPersistedWorktrees(): void {
    try {
      if (!existsSync(this.worktreesJsonPath)) return;

      const text = readFileSync(this.worktreesJsonPath, 'utf-8');
      const data = JSON.parse(text) as Array<Record<string, unknown>>;

      for (const item of data) {
        const id = item.id as string;

        this.worktrees.set(id, {
          id,
          path: item.path as string,
          branch: item.branch as string,
          prNumber: item.prNumber as number,
          repoOwner: item.repoOwner as string,
          repoName: item.repoName as string,
          clonePath: item.clonePath as string,
          sessionId: item.sessionId as string | undefined,
          createdAt: new Date(item.createdAt as string),
          status: item.status as WorktreeInfo['status'],
        });
      }

      this.logger.log(`Loaded ${this.worktrees.size} persisted worktree(s)`);
    } catch {
      this.logger.warn('Failed to load persisted worktree metadata');
    }
  }
}
