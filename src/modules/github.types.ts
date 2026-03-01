export type { RepoConfig } from '../shared/types';

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: { login: string };
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null; // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  labels: Array<{ name: string }>;
}

export interface PullRequestDetail extends PullRequest {
  body: string;
  reviews: Array<{
    author: { login: string };
    state: string;
    body: string;
  }>;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
  }>;
}

export interface PrDiff {
  /** The raw unified diff text from `gh pr diff` */
  raw: string;
  /** PR number this diff belongs to */
  prNumber: number;
  /** Combined owner/repo identifier */
  repoFullName: string;
}
