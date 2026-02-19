import { Injectable } from '@nestjs/common';
import { render } from '@opentui/solid';
import { App } from './tui/app';
import { TaskwarriorService } from './taskwarrior.service';
import { GithubService } from './github.service';
import { ConfigService } from './config.service';
import { TerminalService } from './terminal.service';
import { DependencyService } from './dependency.service';
import { CalendarService } from './calendar.service';
import type { PullRequestDetail, PrDiff } from './github.types';
import type { ProjectAgentConfig } from './config.types';

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
      projectAgentConfig?: ProjectAgentConfig,
    ) => Promise<{ taskUuid: string; sessionId: string }>;
    getPrDiff: (
      owner: string,
      repo: string,
      prNumber: number,
    ) => Promise<PrDiff>;
    getProjectAgentConfig: (
      projectKey: string,
    ) => ProjectAgentConfig | null;
    setProjectAgentConfig: (cfg: ProjectAgentConfig) => void;
    removeProjectAgentConfig: (projectKey: string) => void;
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
        projectAgentConfig?: ProjectAgentConfig,
      ) =>
        this.terminalService.createPrReviewSession(
          prNumber,
          repoOwner,
          repoName,
          prTitle,
          prDetail,
          prDiff,
          projectAgentConfig,
        ),
      getPrDiff: (owner: string, repo: string, prNumber: number) =>
        this.githubService.getPrDiff(owner, repo, prNumber),
      getProjectAgentConfig: (projectKey: string) =>
        this.configService.getProjectAgentConfig(projectKey),
      setProjectAgentConfig: (cfg: ProjectAgentConfig) =>
        this.configService.setProjectAgentConfig(cfg),
      removeProjectAgentConfig: (projectKey: string) =>
        this.configService.removeProjectAgentConfig(projectKey),
    };

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
    });

    // Keep the process alive until the user presses 'q'.
    // The App component calls g.__tuiExit() on quit.
    await exitPromise;
  }
}
