import { Injectable } from '@nestjs/common';
import { render } from '@opentui/solid';
import { App } from './tui/app';
import { TaskwarriorService } from './taskwarrior.service';
import { GithubService } from './github.service';
import { ConfigService } from './config.service';
import { TerminalService } from './terminal.service';
import { DependencyService } from './dependency.service';
import { CalendarService } from './calendar.service';
import { SlackIngestionService } from './slack/slack-ingestion.service';
import { TokenExtractorService } from './slack/token-extractor.service';
import type { ExtractionResult } from './slack/token-extractor.service';
import type {
  PullRequestDetail,
  PrDiff,
  PrReviewComment,
} from './github.types';
import type { ProjectAgentConfig } from './config.types';
import type { DueDateValidation } from './taskwarrior.types';

interface TawtuiGlobal {
  __tawtui?: {
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
    getPrDiff: (
      owner: string,
      repo: string,
      prNumber: number,
    ) => Promise<PrDiff>;
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
  };
  __tuiExit?: () => void;
}

@Injectable()
export class TuiService {
  constructor(
    private readonly taskwarriorService: TaskwarriorService,
    private readonly githubService: GithubService,
    private readonly configService: ConfigService,
    private readonly terminalService: TerminalService,
    private readonly dependencyService: DependencyService,
    private readonly calendarService: CalendarService,
    private readonly slackIngestionService: SlackIngestionService,
    private readonly tokenExtractorService: TokenExtractorService,
  ) {}

  async launch(): Promise<void> {
    const g = globalThis as unknown as TawtuiGlobal;

    // Bridge NestJS services to SolidJS components via globalThis.
    // SolidJS components don't have access to the NestJS DI container,
    // so we expose required services on a well-known global.
    g.__tawtui = {
      taskwarriorService: this.taskwarriorService,
      githubService: this.githubService,
      configService: this.configService,
      terminalService: this.terminalService,
      dependencyService: this.dependencyService,
      calendarService: this.calendarService,
      createPrReviewSession: (
        prNumber: number,
        repoOwner: string,
        repoName: string,
        prTitle: string,
        prDetail?: PullRequestDetail,
        prDiff?: PrDiff,
        prReviewComments?: PrReviewComment[],
        projectAgentConfig?: ProjectAgentConfig,
      ) =>
        this.terminalService.createPrReviewSession(
          prNumber,
          repoOwner,
          repoName,
          prTitle,
          prDetail,
          prDiff,
          prReviewComments,
          projectAgentConfig,
        ),
      getPrDiff: (owner: string, repo: string, prNumber: number) =>
        this.githubService.getPrDiff(owner, repo, prNumber),
      getPrReviewComments: (owner: string, repo: string, prNumber: number) =>
        this.githubService.getPrReviewComments(owner, repo, prNumber),
      getProjectAgentConfig: (projectKey: string) =>
        this.configService.getProjectAgentConfig(projectKey),
      setProjectAgentConfig: (cfg: ProjectAgentConfig) =>
        this.configService.setProjectAgentConfig(cfg),
      removeProjectAgentConfig: (projectKey: string) =>
        this.configService.removeProjectAgentConfig(projectKey),
      destroySessionWithWorktree: (
        sessionId: string,
        cleanupWorktree: boolean,
      ) =>
        this.terminalService.destroySessionWithWorktree(
          sessionId,
          cleanupWorktree,
        ),
      validateDueDate: (value: string) =>
        this.taskwarriorService.validateDueDate(value),
      slackIngestionService: this.slackIngestionService,
      createOracleSession: () => this.terminalService.createOracleSession(),
      extractSlackTokens: () => this.tokenExtractorService.extractTokens(),
    };

    // Start Oracle ingestion if configured and dependencies are met
    const oracleConfig = this.configService.getOracleConfig();
    if (oracleConfig.slack?.xoxcToken && oracleConfig.slack?.xoxdCookie) {
      const depStatus = await this.dependencyService.checkAll();
      if (depStatus.oracleReady) {
        const intervalMs = oracleConfig.pollIntervalSeconds * 1000;
        this.slackIngestionService.startPolling(intervalMs);
      }
    }

    // Set up the exit promise before rendering so the App component
    // can resolve it at any time (even during the initial render pass).
    const exitPromise = new Promise<void>((resolve) => {
      g.__tuiExit = resolve;
    });

    // render() accepts either a CliRenderer or a CliRendererConfig.
    // When given a config object it creates the renderer internally,
    // wraps the component in a RendererContext.Provider, and enters
    // the alternate screen buffer automatically.
    await render(App, {
      useAlternateScreen: true,
      useMouse: true,
      exitOnCtrlC: false,
    });

    // Keep the process alive until the user presses 'q'.
    // The App component calls g.__tuiExit() on quit.
    await exitPromise;

    this.slackIngestionService.stopPolling();
  }
}
