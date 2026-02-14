/**
 * Shared types used across multiple modules.
 */

export interface RepoConfig {
  owner: string;
  repo: string;
  url: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
