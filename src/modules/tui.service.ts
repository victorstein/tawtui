import { Injectable } from '@nestjs/common';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { render } from '@opentui/solid';
import { App } from './tui/app';
import { TaskwarriorService } from './taskwarrior.service';
import { GithubService } from './github.service';
import { ConfigService } from './config.service';
import { TerminalService } from './terminal.service';
import { DependencyService } from './dependency.service';
import { CalendarService } from './calendar.service';
import { NotificationService } from './notification.service';
import { ProjectService } from './project.service';
import { WorktreeService } from './worktree.service';
import { PrDiffParser } from './pr-diff-parser.service';
import { AgentReviewService } from './agent-review.service';
import { HunkService } from './hunk.service';
import { HunkReviewRegistry } from './hunk-review-registry.service';
import type {
  PullRequestDetail,
  PrDiff,
  PrReviewComment,
} from './github.types';
import type { ProjectAgentConfig } from './config.types';
import type { DueDateValidation } from './taskwarrior.types';
import type {
  ReviewBody,
  HunkAvailability,
  LaunchForegroundParams,
  HunkReviewRecord,
} from './hunk-review.types';
import type { ForegroundHooks } from './hunk.service';

interface TawtuiGlobal {
  __tawtui?: {
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
    startHunkReview: (
      owner: string,
      repo: string,
      prNumber: number,
      prTitle: string,
    ) => Promise<{
      prKey: string;
      agentContextPath: string;
      worktreePath: string;
      patchPath: string;
      body: ReviewBody;
    }>;
    runHunkForeground: (
      params: LaunchForegroundParams,
      hooks: Pick<ForegroundHooks, 'suspend' | 'resume'>,
    ) => Promise<void>;
    resolveHunkSessionId: (
      port: number,
      worktreePath?: string,
    ) => Promise<string | null>;
    askHunkChat: (message: string) => Promise<string>;
    listHunkReviews: () => HunkReviewRecord[];
    killHunkReview: (prKey: string) => Promise<void>;
    checkHunkPrereqs: () => Promise<{
      hunk: HunkAvailability;
      claudeAuth: boolean;
    }>;
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
    private readonly notificationService: NotificationService,
    private readonly projectService: ProjectService,
    private readonly worktreeService: WorktreeService,
    private readonly prDiffParser: PrDiffParser,
    private readonly agentReviewService: AgentReviewService,
    private readonly hunkService: HunkService,
    private readonly hunkReviewRegistry: HunkReviewRegistry,
  ) {}

  async startHunkReview(
    owner: string,
    repo: string,
    prNumber: number,
    prTitle: string,
  ): Promise<{
    prKey: string;
    agentContextPath: string;
    worktreePath: string;
    patchPath: string;
    body: ReviewBody;
  }> {
    const wt = await this.worktreeService.createWorktree(
      owner,
      repo,
      prNumber,
      undefined,
      'hunk',
    );
    const prKey = wt.id;
    this.hunkReviewRegistry.add({
      prKey,
      repoOwner: owner,
      repoName: repo,
      prNumber,
      worktreePath: wt.path,
      port: 0,
      status: 'reviewing',
      createdAt: new Date().toISOString(),
    });

    const diff = await this.githubService.getPrDiff(owner, repo, prNumber);
    const patchPath = join(wt.path, 'pr.diff');
    writeFileSync(patchPath, diff.raw, 'utf-8');

    const hunkCfg = this.configService.getHunkConfig();
    const lineMap = this.prDiffParser.parse(diff.raw);
    const agentContextPath = join(
      this.configService.configDirPublic(),
      `hunk-findings-${prNumber}.json`,
    );

    const body = this.prDiffParser.isOverThreshold(
      diff.raw,
      hunkCfg.maxDiffBytes,
    )
      ? {
          summary: 'Diff exceeds size threshold; review-body-only.',
          unanchoredFindings: [],
          unanchoredCount: 0,
        }
      : (
          await this.agentReviewService.startReview({
            diffRaw: diff.raw,
            lineMap,
            agentContextPath,
            authorLabel: hunkCfg.agentAuthorLabel,
            prTitle,
          })
        ).body;

    this.hunkReviewRegistry.update(prKey, {
      status: 'ready',
      sdkSessionId: this.agentReviewService.getSessionId(),
    });

    return { prKey, agentContextPath, worktreePath: wt.path, patchPath, body };
  }

  async killHunkReview(prKey: string): Promise<void> {
    this.agentReviewService.dispose();
    const record = this.hunkReviewRegistry.get(prKey);
    if (record) {
      await this.worktreeService.removeWorktree(prKey);
    }
    this.hunkReviewRegistry.remove(prKey);
  }

  async checkHunkPrereqs(): Promise<{
    hunk: HunkAvailability;
    claudeAuth: boolean;
  }> {
    const hunk = await this.hunkService.isAvailable();
    let claudeAuth = false;
    try {
      const proc = Bun.spawn(['claude', '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      claudeAuth = exitCode === 0;
    } catch {
      claudeAuth = false;
    }
    return { hunk, claudeAuth };
  }

  async launch(): Promise<void> {
    const g = globalThis as unknown as TawtuiGlobal;

    // Bridge NestJS services to SolidJS components via globalThis.
    // SolidJS components don't have access to the NestJS DI container,
    // so we expose required services on a well-known global.
    g.__tawtui = {
      taskwarriorService: this.taskwarriorService,
      projectService: this.projectService,
      githubService: this.githubService,
      configService: this.configService,
      terminalService: this.terminalService,
      dependencyService: this.dependencyService,
      calendarService: this.calendarService,
      notificationService: this.notificationService,
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
      startHunkReview: (
        owner: string,
        repo: string,
        prNumber: number,
        prTitle: string,
      ) => this.startHunkReview(owner, repo, prNumber, prTitle),
      runHunkForeground: (
        params: LaunchForegroundParams,
        hooks: Pick<ForegroundHooks, 'suspend' | 'resume'>,
      ) =>
        this.hunkService.launchForeground(params, {
          ...hooks,
          spawn: (cmd, opts) => HunkService.defaultSpawn(cmd, opts),
          reset: () => HunkService.defaultReset(),
        }),
      resolveHunkSessionId: (port: number, worktreePath?: string) =>
        this.hunkService.resolveSessionId(port, worktreePath),
      askHunkChat: (message: string) => this.agentReviewService.ask(message),
      listHunkReviews: () => this.hunkReviewRegistry.list(),
      killHunkReview: (prKey: string) => this.killHunkReview(prKey),
      checkHunkPrereqs: () => this.checkHunkPrereqs(),
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
      exitOnCtrlC: false,
    });

    // Keep the process alive until the user presses 'q'.
    // The App component calls g.__tuiExit() on quit.
    await exitPromise;
  }
}
