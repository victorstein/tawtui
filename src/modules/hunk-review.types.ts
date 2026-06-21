export type DiffChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFileEntry {
  path: string;
  newLines: Set<number>;
  changeKind: DiffChangeKind;
  binary: boolean;
  oldPath?: string;
}

export interface DiffLineMap {
  files: DiffFileEntry[];
}

export interface AgentContextAnnotation {
  newRange?: [number, number];
  oldRange?: [number, number];
  summary: string;
  rationale?: string;
  author?: string;
}

export interface AgentContextFile {
  path: string;
  summary?: string;
  annotations: AgentContextAnnotation[];
}

export interface AgentContext {
  version: number;
  summary?: string;
  files: AgentContextFile[];
}

export type FindingSeverity = 'info' | 'warning' | 'error';

export interface ReviewFinding {
  file: string;
  line: number | null;
  severity: FindingSeverity;
  summary: string;
  rationale?: string;
}

export interface ReviewBody {
  summary: string;
  unanchoredFindings: ReviewFinding[];
  unanchoredCount: number;
}

export interface ReviewOutput {
  body: ReviewBody;
  anchoredFindings: ReviewFinding[];
  agentContextPath: string;
}

export type HunkReviewStatus =
  | 'creating'
  | 'reviewing'
  | 'ready'
  | 'open'
  | 'error'
  | 'killed';

export interface HunkReviewRecord {
  prKey: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  worktreePath: string;
  port: number;
  sdkSessionId?: string;
  status: HunkReviewStatus;
  createdAt: string;
  error?: string;
}

export interface HunkAvailability {
  available: boolean;
  command: string[];
  detail: string;
}

export interface LaunchForegroundParams {
  worktreePath: string;
  patchPath: string;
  agentContextPath: string;
  port: number;
}
