import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MempalaceService {
  private readonly logger = new Logger(MempalaceService.name);

  /** Check if mempalace is installed by running `mempalace status` */
  isInstalled(): boolean {
    const result = Bun.spawnSync(['python3', '-m', 'mempalace', 'status'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
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
      ['python3', '-m', 'mempalace', 'mine', dir, '--mode', 'convos', '--wing', wing],
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
