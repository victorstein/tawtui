import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';

/** Base directory for all tawtui data files. */
export const TAWTUI_DATA_DIR = join(homedir(), '.local', 'share', 'tawtui');

/** Path to the mempalace palace database. */
export const PALACE_PATH = join(TAWTUI_DATA_DIR, 'mempalace');

/** Staging directory for raw Slack message JSON files. */
export const STAGING_DIR = join(TAWTUI_DATA_DIR, 'slack-inbox');

/** Working directory for Oracle Claude Code sessions (project-scoped plugin). */
export const ORACLE_WORKSPACE_DIR = join(TAWTUI_DATA_DIR, 'oracle-workspace');

@Injectable()
export class MempalaceService {
  private readonly logger = new Logger(MempalaceService.name);

  /** Check if mempalace CLI is installed by running `mempalace status`. */
  isInstalled(): boolean {
    const result = Bun.spawnSync(['mempalace', 'status'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  }

  /** Check if the palace has been initialized (palace.db exists). */
  isInitialized(): boolean {
    return existsSync(join(PALACE_PATH, 'palace.db'));
  }

  /** Initialize a new mempalace palace at the given path. */
  async init(palacePath: string): Promise<void> {
    const proc = Bun.spawn(['mempalace', 'init', palacePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `mempalace init failed (exit ${exitCode}): ${stderr}`,
      );
    }

    this.logger.log(`Initialized palace at ${palacePath}`);
  }

  /**
   * Mine existing data from the staging directory if any .json files exist.
   * Returns whether mining actually ran.
   */
  async mineIfNeeded(
    stagingDir: string,
    wing: string,
  ): Promise<{ mined: boolean }> {
    if (!existsSync(stagingDir)) return { mined: false };

    const files = readdirSync(stagingDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return { mined: false };

    await this.mine(stagingDir, wing);
    return { mined: true };
  }

  /**
   * Mine a directory of conversation files into mempalace.
   * Uses `mempalace mine <dir> --mode convos --wing <wing>`.
   *
   * Mining is idempotent — already-processed files are skipped automatically
   * (mempalace deduplicates by source file path).
   *
   * Uses async Bun.spawn() to avoid blocking the TUI event loop.
   */
  async mine(dir: string, wing: string): Promise<void> {
    const proc = Bun.spawn(
      ['mempalace', 'mine', dir, '--mode', 'convos', '--wing', wing],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`mempalace mine failed (exit ${exitCode}): ${stderr}`);
    }

    this.logger.log(`Mined ${dir} into wing "${wing}"`);
  }
}
