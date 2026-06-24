export interface ManagedRepo {
  owner: string;
  repo: string;
  clonePath: string; // ~/.local/share/tawtui/repos/{owner}/{repo}
  clonedAt: Date;
  lastFetchedAt?: Date;
}

export interface WorktreeInfo {
  id: string; // "{owner}/{repo}#pr-{number}" or "{owner}/{repo}#pr-{number}-{namespace}"
  path: string; // ~/.local/share/tawtui/repos/{owner}/{repo}-worktrees/pr-{N}
  branch: string; // local branch name: tawtui/pr-{number} or tawtui/pr-{number}-{namespace}
  prNumber: number;
  repoOwner: string;
  repoName: string;
  clonePath: string; // path to the managed clone
  sessionId?: string; // linked terminal session
  namespace?: string; // optional namespace suffix (e.g. 'hunk') for flow isolation
  createdAt: Date;
  status: 'creating' | 'active' | 'orphaned' | 'removing';
}
