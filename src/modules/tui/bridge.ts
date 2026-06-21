import type { TaskwarriorService } from '../taskwarrior.service';
import type { ProjectService } from '../project.service';
import type { GithubService } from '../github.service';
import type { ConfigService } from '../config.service';
import type { TerminalService } from '../terminal.service';
import type { DependencyService } from '../dependency.service';
import type { CalendarService } from '../calendar.service';
import type { NotificationService } from '../notification.service';
import type {
  PullRequestDetail,
  PrDiff,
  PrReviewComment,
} from '../github.types';
import type { ProjectAgentConfig } from '../config.types';
import type { DueDateValidation } from '../taskwarrior.types';
import type {
  HunkAvailability,
  LaunchForegroundParams,
  HunkReviewRecord,
} from '../hunk-review.types';
import type { ForegroundHooks } from '../hunk.service';

export interface TawtuiBridge {
  taskwarriorService: TaskwarriorService;
  projectService: ProjectService;
  githubService: GithubService;
  configService: ConfigService;
  terminalService: TerminalService;
  dependencyService: DependencyService;
  calendarService: CalendarService;
  notificationService: NotificationService;
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
  startHunkReview: (
    owner: string,
    repo: string,
    prNumber: number,
    prTitle: string,
  ) => Promise<{ prKey: string; existing: boolean }>;
  runHunkForeground: (
    params: LaunchForegroundParams,
    hooks: ForegroundHooks,
  ) => Promise<void>;
  resolveHunkSessionId: (
    port: number,
    worktreePath?: string,
  ) => Promise<string | null>;
  askHunkChat: (prKey: string, message: string) => Promise<string>;
  listHunkReviews: () => HunkReviewRecord[];
  killHunkReview: (prKey: string) => Promise<void>;
  checkHunkPrereqs: () => Promise<{
    hunk: HunkAvailability;
    claudeAuth: boolean;
  }>;
}

function getBridge(): TawtuiBridge | undefined {
  return (globalThis as Record<string, unknown>).__tawtui as
    | TawtuiBridge
    | undefined;
}

export function getTaskwarriorService(): TaskwarriorService | null {
  return getBridge()?.taskwarriorService ?? null;
}

export function getProjectService(): ProjectService | null {
  return getBridge()?.projectService ?? null;
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

export function getNotificationService(): NotificationService | null {
  return getBridge()?.notificationService ?? null;
}

export function getTuiExit(): (() => void) | null {
  const exit = (globalThis as Record<string, unknown>).__tuiExit;
  return typeof exit === 'function' ? (exit as () => void) : null;
}

export function getStartHunkReview(): TawtuiBridge['startHunkReview'] | null {
  return getBridge()?.startHunkReview ?? null;
}

export function getRunHunkForeground():
  | TawtuiBridge['runHunkForeground']
  | null {
  return getBridge()?.runHunkForeground ?? null;
}

export function getResolveHunkSessionId():
  | TawtuiBridge['resolveHunkSessionId']
  | null {
  return getBridge()?.resolveHunkSessionId ?? null;
}

export function getAskHunkChat(): TawtuiBridge['askHunkChat'] | null {
  return getBridge()?.askHunkChat ?? null;
}

export function getListHunkReviews(): TawtuiBridge['listHunkReviews'] | null {
  return getBridge()?.listHunkReviews ?? null;
}

export function getKillHunkReview(): TawtuiBridge['killHunkReview'] | null {
  return getBridge()?.killHunkReview ?? null;
}

export function getCheckHunkPrereqs(): TawtuiBridge['checkHunkPrereqs'] | null {
  return getBridge()?.checkHunkPrereqs ?? null;
}
