import type { TaskwarriorService } from '../taskwarrior.service';
import type { GithubService } from '../github.service';
import type { ConfigService } from '../config.service';
import type { TerminalService } from '../terminal.service';
import type { DependencyService } from '../dependency.service';
import type { CalendarService } from '../calendar.service';
import type { PullRequestDetail, PrDiff } from '../github.types';
import type { ProjectAgentConfig } from '../config.types';

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
    projectAgentConfig?: ProjectAgentConfig,
  ) => Promise<{ taskUuid: string; sessionId: string }>;
  getPrDiff: (
    owner: string,
    repo: string,
    prNumber: number,
  ) => Promise<PrDiff>;
  getProjectAgentConfig: (projectKey: string) => ProjectAgentConfig | null;
  setProjectAgentConfig: (cfg: ProjectAgentConfig) => void;
  removeProjectAgentConfig: (projectKey: string) => void;
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

export function getTuiExit(): (() => void) | null {
  const exit = (globalThis as Record<string, unknown>).__tuiExit;
  return typeof exit === 'function' ? (exit as () => void) : null;
}
