import { Injectable } from '@nestjs/common';
import type {
  PrDiff,
  PrReviewComment,
  PullRequest,
  PullRequestDetail,
  RepoConfig,
} from './github.types';

interface GraphqlReviewThreadCommentNode {
  databaseId: number;
  author: { login: string } | null;
  body: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  createdAt: string;
  replyTo: { databaseId: number } | null;
}

interface GraphqlReviewThreadNode {
  isResolved: boolean;
  isOutdated: boolean;
  comments: {
    nodes: GraphqlReviewThreadCommentNode[];
  };
}

interface GraphqlReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GraphqlReviewThreadNode[];
        };
      };
    };
  };
}

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

  async getPrDiff(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PrDiff> {
    const result = await this.execGh([
      'pr',
      'diff',
      String(prNumber),
      '--repo',
      `${owner}/${repo}`,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to get diff for PR #${prNumber} in ${owner}/${repo}: ${result.stderr}`,
      );
    }

    return {
      raw: result.stdout,
      prNumber,
      repoFullName: `${owner}/${repo}`,
    };
  }

  async getPrReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PrReviewComment[]> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                isResolved
                isOutdated
                comments(first: 100) {
                  nodes {
                    databaseId
                    author { login }
                    body
                    path
                    line
                    originalLine
                    createdAt
                    replyTo { databaseId }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const accumulated: PrReviewComment[] = [];
    let cursor: string | null = null;

    // Paginate through reviewThreads using GraphQL pageInfo cursors.
    do {
      const args = [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${prNumber}`,
      ];
      if (cursor) {
        args.push('-F', `cursor=${cursor}`);
      }

      const result = await this.execGh(args);
      if (result.exitCode !== 0) {
        return [];
      }

      let parsed: GraphqlReviewThreadsResponse;
      try {
        parsed = JSON.parse(result.stdout) as GraphqlReviewThreadsResponse;
      } catch {
        return [];
      }

      const threadsConn = parsed?.data?.repository?.pullRequest?.reviewThreads;
      if (!threadsConn) {
        return [];
      }

      for (const thread of threadsConn.nodes ?? []) {
        const nodes = thread.comments?.nodes ?? [];
        for (const node of nodes) {
          const comment: PrReviewComment = {
            id: node.databaseId,
            user: { login: node.author?.login ?? 'unknown' },
            body: node.body ?? '',
            path: node.path ?? '',
            line: node.line ?? node.originalLine ?? null,
            created_at: node.createdAt ?? '',
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
          };
          if (node.replyTo?.databaseId != null) {
            comment.in_reply_to_id = node.replyTo.databaseId;
          }
          accumulated.push(comment);
        }
      }

      cursor = threadsConn.pageInfo?.hasNextPage
        ? (threadsConn.pageInfo.endCursor ?? null)
        : null;
    } while (cursor);

    return accumulated;
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
      /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?$/,
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
