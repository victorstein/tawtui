import type { TaskwarriorService } from '../taskwarrior.service';
import type { GithubService } from '../github.service';
import type { ConfigService } from '../config.service';
import type { TerminalService } from '../terminal.service';
import type { DependencyService } from '../dependency.service';
import type { CalendarService } from '../calendar.service';
import type {
  PullRequestDetail,
  PrDiff,
  PrReviewComment,
} from '../github.types';
import type { ProjectAgentConfig } from '../config.types';
import type { DueDateValidation } from '../taskwarrior.types';
import type { SlackIngestionService } from '../slack/slack-ingestion.service';
import type { ExtractionResult } from '../slack/token-extractor.service';

export interface OracleInitProgress {
  message: string;
  status: 'running' | 'done' | 'skip';
}

export interface TawtuiBridge {
  taskwarriorService: TaskwarriorService;
  githubService: GithubService;
  configService: ConfigService;
  terminalService: TerminalService;
  dependencyService: DependencyService;
  calendarService: CalendarService;
  createPrReviewSession: (
    prNumber: number,
    repoOwner: string,
    repoName: string,
    prTitle: string,
    prDetail?: PullRequestDetail,
    prDiff?: PrDiff,
    prReviewComments?: PrReviewComment[],
    projectAgentConfig?: ProjectAgentConfig,
  ) => Promise<{ sessionId: string }>;
  getPrDiff: (owner: string, repo: string, prNumber: number) => Promise<PrDiff>;
  getPrReviewComments: (
    owner: string,
    repo: string,
    prNumber: number,
  ) => Promise<PrReviewComment[]>;
  getProjectAgentConfig: (projectKey: string) => ProjectAgentConfig | null;
  setProjectAgentConfig: (cfg: ProjectAgentConfig) => void;
  removeProjectAgentConfig: (projectKey: string) => void;
  destroySessionWithWorktree: (
    sessionId: string,
    cleanupWorktree: boolean,
  ) => Promise<void>;
  validateDueDate: (value: string) => DueDateValidation;
  slackIngestionService: SlackIngestionService;
  createOracleSession: () => Promise<{ sessionId: string }>;
  extractSlackTokens: () => Promise<ExtractionResult>;
  initializeOracle: (
    onProgress: (progress: OracleInitProgress) => void,
  ) => Promise<void>;
  resetOracleData: () => Promise<void>;
}

function getBridge(): TawtuiBridge | undefined {
  return (globalThis as Record<string, unknown>).__tawtui as
    | TawtuiBridge
    | undefined;
}

export function getTaskwarriorService(): TaskwarriorService | null {
  return getBridge()?.taskwarriorService ?? null;
}

export function getGithubService(): GithubService | null {
  return getBridge()?.githubService ?? null;
}

export function getConfigService(): ConfigService | null {
  return getBridge()?.configService ?? null;
}

export function getTerminalService(): TerminalService | null {
  return getBridge()?.terminalService ?? null;
}

export function getDependencyService(): DependencyService | null {
  return getBridge()?.dependencyService ?? null;
}

export function getCalendarService(): CalendarService | null {
  return getBridge()?.calendarService ?? null;
}

export function getCreatePrReviewSession():
  | TawtuiBridge['createPrReviewSession']
  | null {
  return getBridge()?.createPrReviewSession ?? null;
}

export function getDestroySessionWithWorktree():
  | TawtuiBridge['destroySessionWithWorktree']
  | null {
  return getBridge()?.destroySessionWithWorktree ?? null;
}

export function getValidateDueDate(): TawtuiBridge['validateDueDate'] | null {
  return getBridge()?.validateDueDate ?? null;
}

export function getSlackIngestionService(): SlackIngestionService | null {
  return getBridge()?.slackIngestionService ?? null;
}

export function getCreateOracleSession():
  | TawtuiBridge['createOracleSession']
  | null {
  return getBridge()?.createOracleSession ?? null;
}

export function getExtractSlackTokens():
  | TawtuiBridge['extractSlackTokens']
  | null {
  return getBridge()?.extractSlackTokens ?? null;
}

export function getInitializeOracle(): TawtuiBridge['initializeOracle'] | null {
  return getBridge()?.initializeOracle ?? null;
}

export function getResetOracleData(): TawtuiBridge['resetOracleData'] | null {
  return getBridge()?.resetOracleData ?? null;
}

export function getTuiExit(): (() => void) | null {
  const exit = (globalThis as Record<string, unknown>).__tuiExit;
  return typeof exit === 'function' ? (exit as () => void) : null;
}
