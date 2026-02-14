import { Injectable } from '@nestjs/common';
import type {
  PullRequest,
  PullRequestDetail,
  RepoConfig,
} from './github.types';

@Injectable()
export class GithubService {
  private async execGh(args: string[]): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    try {
      const proc = Bun.spawn(['gh', ...args], {
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
        stderr: 'gh binary not found',
        exitCode: 1,
      };
    }
  }

  async isGhInstalled(): Promise<boolean> {
    const result = await this.execGh(['--version']);
    return result.exitCode === 0;
  }

  async isAuthenticated(): Promise<boolean> {
    const result = await this.execGh(['auth', 'status']);
    return result.exitCode === 0;
  }

  async listPRs(owner: string, repo: string): Promise<PullRequest[]> {
    const fields = [
      'number',
      'title',
      'url',
      'author',
      'state',
      'isDraft',
      'headRefName',
      'baseRefName',
      'reviewDecision',
      'statusCheckRollup',
      'additions',
      'deletions',
      'changedFiles',
      'createdAt',
      'updatedAt',
      'labels',
    ].join(',');

    const result = await this.execGh([
      'pr',
      'list',
      '--repo',
      `${owner}/${repo}`,
      '--state',
      'open',
      '--json',
      fields,
      '--limit',
      '50',
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to list PRs for ${owner}/${repo}: ${result.stderr}`,
      );
    }

    try {
      return JSON.parse(result.stdout) as PullRequest[];
    } catch {
      throw new Error(
        `Failed to parse PR list response for ${owner}/${repo}: ${result.stdout}`,
      );
    }
  }

  async getPR(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestDetail> {
    const fields = [
      'number',
      'title',
      'url',
      'author',
      'state',
      'isDraft',
      'headRefName',
      'baseRefName',
      'reviewDecision',
      'statusCheckRollup',
      'additions',
      'deletions',
      'changedFiles',
      'createdAt',
      'updatedAt',
      'labels',
      'body',
      'reviews',
      'files',
      'comments',
    ].join(',');

    const result = await this.execGh([
      'pr',
      'view',
      String(prNumber),
      '--repo',
      `${owner}/${repo}`,
      '--json',
      fields,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get PR #${prNumber} for ${owner}/${repo}: ${result.stderr}`,
      );
    }

    try {
      return JSON.parse(result.stdout) as PullRequestDetail;
    } catch {
      throw new Error(
        `Failed to parse PR detail response for ${owner}/${repo}#${prNumber}: ${result.stdout}`,
      );
    }
  }

  async validateRepo(owner: string, repo: string): Promise<boolean> {
    const result = await this.execGh(['repo', 'view', `${owner}/${repo}`]);
    return result.exitCode === 0;
  }

  parseRepoUrl(url: string): RepoConfig | null {
    if (!url || typeof url !== 'string') {
      return null;
    }

    const trimmed = url.trim();

    // Handle HTTPS URLs: https://github.com/owner/repo(.git)
    const httpsMatch = trimmed.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (httpsMatch) {
      const [, owner, repo] = httpsMatch;
      return {
        owner,
        repo,
        url: `https://github.com/${owner}/${repo}`,
      };
    }

    // Handle SSH URLs: git@github.com:owner/repo(.git)
    const sshMatch = trimmed.match(
      /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (sshMatch) {
      const [, owner, repo] = sshMatch;
      return {
        owner,
        repo,
        url: `https://github.com/${owner}/${repo}`,
      };
    }

    // Handle shorthand: owner/repo
    const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (shorthandMatch) {
      const [, owner, repo] = shorthandMatch;
      return {
        owner,
        repo,
        url: `https://github.com/${owner}/${repo}`,
      };
    }

    return null;
  }
}
