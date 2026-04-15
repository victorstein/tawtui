import { SlackService } from '../../src/modules/slack/slack.service';
import { SlackIngestionService } from '../../src/modules/slack/slack-ingestion.service';
import { MempalaceService } from '../../src/modules/slack/mempalace.service';
import type { ConfigService } from '../../src/modules/config.service';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { OracleState } from '../../src/modules/slack/slack.types';

export interface SlackStack {
  slackService: SlackService;
  ingestionService: SlackIngestionService;
  mempalaceService: MempalaceService;
  configService: ConfigService;
  statePath: string;
  stagingDir: string;
  tmpDir: string;
  cleanup: () => void;
}

export class IntegrationHelper {
  /**
   * Create a full Slack service stack with real services wired together.
   * Mock fetch globally BEFORE calling this.
   * Mock Bun.spawn/spawnSync globally BEFORE calling this.
   */
  static createSlackStack(options?: {
    initialState?: Partial<OracleState>;
  }): SlackStack {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-integration-'));
    const stagingDir = join(tmpDir, 'staging');
    const configDir = join(tmpDir, 'config');
    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const statePath = join(configDir, 'oracle-state.json');
    if (options?.initialState) {
      const state: OracleState = {
        lastChecked: options.initialState.lastChecked ?? null,
        channelCursors: options.initialState.channelCursors ?? {},
        ...options.initialState,
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }

    const configService = {
      getOracleConfig: jest.fn().mockReturnValue({
        slack: {
          xoxcToken: 'xoxc-test',
          xoxdCookie: 'xoxd-test',
        },
        pollIntervalSeconds: 300,
      }),
      updateOracleConfig: jest.fn(),
    } as unknown as ConfigService;

    const slackService = new SlackService(configService);
    const mempalaceService = new MempalaceService();
    const ingestionService = new SlackIngestionService(
      slackService,
      mempalaceService,
    );

    // Override private paths to use temp directories
    const ingestionServiceWithPaths =
      ingestionService as typeof ingestionService & {
        statePath: string;
        stagingDir: string;
      };
    ingestionServiceWithPaths.statePath = statePath;
    ingestionServiceWithPaths.stagingDir = stagingDir;

    return {
      slackService,
      ingestionService,
      mempalaceService,
      configService,
      statePath,
      stagingDir,
      tmpDir,
      cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
    };
  }
}
