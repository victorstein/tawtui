import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'fs';

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

  /** Delete both the local config and the ChromaDB data so the setup flow can reinitialize. */
  reset(): void {
    rmSync(PALACE_PATH, { recursive: true, force: true });
    const chromaPath = join(homedir(), '.mempalace', 'palace');
    rmSync(chromaPath, { recursive: true, force: true });
    this.logger.log('Palace deleted (config + ChromaDB data)');
  }

  /** Check if the palace has been initialized (mempalace.yaml exists). */
  isInitialized(): boolean {
    return existsSync(join(PALACE_PATH, 'mempalace.yaml'));
  }

  /** Initialize a new mempalace palace at the given path. */
  async init(palacePath: string): Promise<void> {
    mkdirSync(palacePath, { recursive: true });

    const proc = Bun.spawn(['mempalace', 'init', palacePath], {
      stdin: new Blob(['\n']),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`mempalace init failed (exit ${exitCode}): ${stderr}`);
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
   * Install the mempalace Claude Code plugin at project scope in the given
   * workspace directory. Creates the directory if it doesn't exist.
   */
  async installPlugin(workspaceDir: string): Promise<void> {
    mkdirSync(workspaceDir, { recursive: true });

    // Step 1: Add plugin from marketplace (idempotent if already added)
    const addProc = Bun.spawn(
      ['claude', 'plugin', 'marketplace', 'add', 'milla-jovovich/mempalace'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    await addProc.exited;
    // Ignore exit code — marketplace add may warn if already added

    // Step 2: Install at project scope in workspace directory
    const installProc = Bun.spawn(
      ['claude', 'plugin', 'install', '--scope', 'project', 'mempalace'],
      { stdout: 'pipe', stderr: 'pipe', cwd: workspaceDir },
    );

    const exitCode = await installProc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(installProc.stderr).text();
      throw new Error(`plugin install failed (exit ${exitCode}): ${stderr}`);
    }

    this.logger.log(`Installed mempalace plugin in ${workspaceDir}`);
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
