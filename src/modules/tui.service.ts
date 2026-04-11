import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { render } from '@opentui/solid';
import { App } from './tui/app';
import { TaskwarriorService } from './taskwarrior.service';
import { GithubService } from './github.service';
import { ConfigService } from './config.service';
import { TerminalService } from './terminal.service';
import { DependencyService } from './dependency.service';
import { CalendarService } from './calendar.service';
import { SlackService } from './slack/slack.service';
import { SlackIngestionService } from './slack/slack-ingestion.service';
import { TokenExtractorService } from './slack/token-extractor.service';
import {
  MempalaceService,
  PALACE_PATH,
  STAGING_DIR,
  ORACLE_WORKSPACE_DIR,
} from './slack/mempalace.service';
import type { ExtractionResult } from './slack/token-extractor.service';
import type {
  PullRequestDetail,
  PrDiff,
  PrReviewComment,
} from './github.types';
import type { ProjectAgentConfig } from './config.types';
import type { DueDateValidation } from './taskwarrior.types';
import { ORACLE_INIT_CANCELLED } from './tui/bridge';

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
    initializeOracle: (
      onProgress: (progress: {
        message: string;
        status: 'running' | 'done' | 'skip';
      }) => void,
    ) => Promise<void>;
    resetOracleData: () => Promise<void>;
    cancelOracleInit: () => void;
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
    private readonly slackService: SlackService,
    private readonly slackIngestionService: SlackIngestionService,
    private readonly tokenExtractorService: TokenExtractorService,
    private readonly mempalaceService: MempalaceService,
  ) {}

  async launch(): Promise<void> {
    const g = globalThis as unknown as TawtuiGlobal;

    // Bridge NestJS services to SolidJS components via globalThis.
    // SolidJS components don't have access to the NestJS DI container,
    // so we expose required services on a well-known global.
    let initCancelled = false;

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
      initializeOracle: async (onProgress) => {
        initCancelled = false;

        // Step 1: Initialize palace (skip if already done)
        if (!this.mempalaceService.isInitialized()) {
          onProgress({ message: 'Initializing palace...', status: 'running' });
          await this.mempalaceService.init(PALACE_PATH);
          onProgress({ message: 'Palace initialized', status: 'done' });
        } else {
          onProgress({ message: 'Palace already initialized', status: 'skip' });
        }

        // Step 1b: Detect user identity
        const oracleConfig = this.configService.getOracleConfig();
        if (!oracleConfig.slack?.userName) {
          onProgress({
            message: 'Detecting user identity...',
            status: 'running',
          });
          const { userName } = await this.slackService.getCurrentUser();
          this.configService.updateOracleConfig({
            slack: { ...oracleConfig.slack!, userName },
          });
          onProgress({
            message: `Detected user: ${userName}`,
            status: 'done',
          });
        } else {
          onProgress({
            message: `User: ${oracleConfig.slack.userName}`,
            status: 'skip',
          });
        }

        if (initCancelled) throw new Error(ORACLE_INIT_CANCELLED);

        // Step 2: Mine existing data
        onProgress({ message: 'Mining existing data...', status: 'running' });
        const mineResult = await this.mempalaceService.mineIfNeeded(
          STAGING_DIR,
          'slack',
        );
        onProgress({
          message: mineResult.mined
            ? 'Mined existing data'
            : 'No existing data to mine',
          status: mineResult.mined ? 'done' : 'skip',
        });

        // Step 2b: Fetch conversations (skipExisting skips already-processed channels)
        {
          await this.slackIngestionService.ingest(
            (info) => {
              if (info.phase === 'waiting') {
                // Only surface rate-limit (429) waits — throttle is just normal pacing
                if (info.waitReason !== 'rate-limited') return;
                const secs = Math.ceil((info.waitMs ?? 0) / 1000);
                const ctx = info.channel
                  ? ` (${info.channel} [${info.channelIndex}/${info.totalChannels}])`
                  : info.channelsSoFar
                    ? ` (channel list, ${info.channelsSoFar} found)`
                    : ' (channel list)';
                onProgress({
                  message: `Rate limited${ctx}, retrying in ${secs}s...`,
                  status: 'running',
                });
              } else if (info.phase === 'detecting') {
                onProgress({
                  message: info.channelsSoFar
                    ? `Detecting active channels... (${info.channelsSoFar} found)`
                    : 'Detecting active channels...',
                  status: 'running',
                });
              } else if (info.phase === 'skipped') {
                onProgress({
                  message: `Skipping ${info.channel} (cached) [${info.channelIndex}/${info.totalChannels}]`,
                  status: 'running',
                });
              } else if (info.phase === 'listing') {
                onProgress({
                  message: info.channelsSoFar
                    ? `Fetching channel list... (${info.channelsSoFar} found, page ${info.page})`
                    : 'Fetching channel list...',
                  status: 'running',
                });
              } else if (info.messageCount && info.messageCount > 0) {
                onProgress({
                  message: `Fetched ${info.channel} (${info.messageCount} messages) [${info.channelIndex}/${info.totalChannels}]`,
                  status: 'running',
                });
              } else {
                onProgress({
                  message: `Fetching ${info.channel}... [${info.channelIndex}/${info.totalChannels}]`,
                  status: 'running',
                });
              }
            },
            { skipExisting: true },
          );
          if (initCancelled) throw new Error(ORACLE_INIT_CANCELLED);
          onProgress({ message: 'Conversations fetched', status: 'done' });
        }

        // Step 3: Install Claude Code plugin
        onProgress({
          message: 'Installing Claude Code plugin...',
          status: 'running',
        });
        await this.mempalaceService.installPlugin(ORACLE_WORKSPACE_DIR);
        onProgress({ message: 'Plugin installed', status: 'done' });

        // Step 4: Install Oracle channel server in workspace .mcp.json
        onProgress({
          message: 'Installing Oracle channel...',
          status: 'running',
        });
        {
          const mcpJsonPath = join(ORACLE_WORKSPACE_DIR, '.mcp.json');
          let mcpConfig: Record<string, unknown> = {};
          if (existsSync(mcpJsonPath)) {
            try {
              mcpConfig = JSON.parse(
                readFileSync(mcpJsonPath, 'utf-8'),
              ) as Record<string, unknown>;
            } catch {
              // Corrupted — will be overwritten
            }
          }
          const mcpServers =
            (mcpConfig.mcpServers as Record<string, unknown>) ?? {};
          const channelServerPath = join(
            __dirname,
            'oracle',
            'oracle-channel.ts',
          );
          mcpServers['oracle-channel'] = {
            command: 'bun',
            args: [channelServerPath],
          };
          mcpConfig.mcpServers = mcpServers;
          writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
        }
        onProgress({ message: 'Oracle channel installed', status: 'done' });
      },
      resetOracleData: async () => {
        this.slackIngestionService.resetState();
        this.mempalaceService.reset();
        const currentConfig = this.configService.getOracleConfig();
        if (currentConfig.slack) {
          this.configService.updateOracleConfig({
            slack: { ...currentConfig.slack, userName: undefined },
          });
        }
      },
      cancelOracleInit: () => {
        initCancelled = true;
        this.slackIngestionService.abort();
      },
    };

    // Start Oracle ingestion, auto-launch session, and fire daily digest if needed
    const oracleConfig = this.configService.getOracleConfig();
    if (oracleConfig.slack?.xoxcToken && oracleConfig.slack?.xoxdCookie) {
      const depStatus = await this.dependencyService.checkAll();
      if (depStatus.oracleReady) {
        const intervalMs = oracleConfig.pollIntervalSeconds * 1000;
        this.slackIngestionService.startPolling(intervalMs);

        // Wire up oracle event service for channel notifications
        const { OracleEventService } =
          await import('./oracle/oracle-event.service');
        const oracleEventService = new OracleEventService(ORACLE_WORKSPACE_DIR);
        this.slackIngestionService.oracleEventService = oracleEventService;

        // Auto-launch oracle session (reuses existing if running)
        try {
          await this.terminalService.createOracleSession();
        } catch {
          // Oracle auto-launch failed — non-fatal, session can be started manually
        }

        // Fire daily digest if >12h since last one
        const lastDigest = oracleConfig.lastDigestAt
          ? new Date(oracleConfig.lastDigestAt)
          : null;
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        const needsDigest =
          !lastDigest || Date.now() - lastDigest.getTime() > twelveHoursMs;

        if (needsDigest) {
          const rejectedTasks = oracleEventService.readRejectedTasks(
            lastDigest ?? undefined,
          );
          void oracleEventService.postEvent({
            type: 'daily-digest',
            rejectedTasks,
          });
          this.configService.updateOracleConfig({
            lastDigestAt: new Date().toISOString(),
          });
        }
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

    // Stop polling and abort any in-flight ingestion to release Slack API quota
    this.slackIngestionService.stopPolling();
    this.slackIngestionService.abort();
  }
}
