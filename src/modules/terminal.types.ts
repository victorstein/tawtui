export interface TerminalSession {
  id: string;
  tmuxSessionName: string;
  tmuxPaneId: string;
  name: string; // display name (e.g., "Review PR #142")
  cwd: string;
  command?: string; // initial command to run
  status: 'running' | 'done' | 'failed';
  createdAt: Date;
  prNumber?: number; // associated PR if any
  repoOwner?: string;
  repoName?: string;
  worktreeId?: string; // linked worktree ID
  worktreePath?: string; // denormalized path for UI display
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface CaptureResult {
  content: string;
  cursor: CursorPosition;
  changed: boolean; // whether content changed since last capture
}
