# Oracle Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Oracle" tab to tawtui that continuously ingests the user's Slack conversations via a background daemon and surfaces action items as Taskwarrior tasks through a running Claude Code session — all without requiring a Slack app, admin approval, or any API costs beyond the existing Claude subscription.

**Architecture:** A background daemon (`tawtui daemon`) polls the Slack API every 5 minutes using the user's browser session tokens (xoxc + xoxd, extracted via the `slacktokens` Python tool — no app creation or admin approval required). Messages are stored locally in mempalace (a Python-based local-first memory store with a built-in MCP server). The Oracle TUI tab spawns a Claude Code tmux session that reads mempalace via MCP, extracts action items, and creates Taskwarrior tasks using the existing `task` CLI — which tawtui already uses, so new tasks appear instantly in the Tasks tab. The tab is auth-gated: if tokens or mempalace are not configured, it renders an inline setup wizard (not a dialog overlay) that walks the user step-by-step through the one-time setup.

**Tech Stack:** TypeScript, NestJS 11, Bun, SolidJS, OpenTUI, Slack Web API (raw fetch with xoxc/xoxd), slacktokens (Python, token extraction), mempalace (Python, local memory store + MCP server), tmux (Claude session management, same pattern as PR reviews), Taskwarrior CLI (task creation via existing TaskwarriorService)

---

## Context: How tawtui Works (Read First)

This plan assumes zero prior knowledge of the tawtui codebase. These are the patterns you **must** follow:

### NestJS + SolidJS Bridge Pattern
tawtui is a NestJS application that renders a SolidJS terminal UI. NestJS services cannot be imported directly into SolidJS components because they live in different contexts. The bridge is via `globalThis.__tawtui` — a plain object set in `TuiService.launch()` that SolidJS components access through typed accessor functions in `src/modules/tui/bridge.ts`.

**Adding a new service to the bridge requires changes in 3 files:**
1. `src/modules/tui.service.ts` — inject service, add to `g.__tawtui = { ... }`
2. `src/modules/tui/bridge.ts` — add to `TawtuiBridge` interface, add accessor function
3. `src/modules/tui.module.ts` — import the new NestJS module

### Tab Structure
Tabs are defined in `TABS` array in `src/modules/tui/app.tsx`. Each tab maps to a `<Match when={activeTab() === N}>` block. The `StatusBar` component reads `TAB_HINTS[activeTab()]`. Adding a tab requires updating both.

### Auth Gating Pattern (Calendar model)
If a tab's feature is not configured/authenticated, it shows an error state with hints. The `DependencyService.checkAll()` is called on app mount and populates a `DependencyStatus` object. Each tab reads its relevant flag from this object.

For Oracle, the pattern is different from Calendar: instead of showing the main content with an error overlay, the Oracle tab renders **either** `<OracleSetupScreen />` **or** `<OracleSessionView />` based on an `oracleReady` signal computed from `DependencyStatus`.

### TerminalService Session Pattern (PR Reviews model)
All Claude sessions are tmux sessions managed by `TerminalService`. A session is created with `createSession({ name, cwd, command })` which spawns a detached tmux session and sends the command to it. The TUI polls the session output every 200-500ms via `captureOutput(sessionId)`. See `src/modules/terminal.service.ts`.

### Taskwarrior Interaction
All taskwarrior calls go through `TaskwarriorService` (wraps `task` CLI via `Bun.spawnSync`). The `+oracle +slack` tags will be used to identify Oracle-created tasks and support deduplication.

### Config
User config lives at `~/.config/tawtui/config.json`. The `ConfigService` reads/writes it atomically. New config sections follow the `calendar?: CalendarConfig` optional field pattern.

### Runtime
Bun only. Never use npm or yarn. Run tests with `bun run test`. Format with `bun run format`. Lint with `bun run lint`.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/modules/slack/slack.types.ts` | Types for Slack messages, channels, conversations |
| `src/modules/slack/slack.service.ts` | Raw HTTP calls to Slack API using xoxc+xoxd tokens |
| `src/modules/slack/mempalace.service.ts` | Subprocess wrapper for the `mempalace` Python CLI |
| `src/modules/slack/slack-ingestion.service.ts` | Orchestrates polling + storing; handles last_checked state |
| `src/modules/slack/slack.module.ts` | NestJS module wiring |
| `src/commands/daemon.command.ts` | `tawtui daemon` CLI command (runs ingestion without TUI) |
| `src/modules/daemon.module.ts` | Minimal NestJS module for daemon (no TUI services) |
| `src/modules/tui/views/oracle-view.tsx` | Oracle tab root — switches between setup and session |
| `src/modules/tui/components/oracle-setup-screen.tsx` | Inline auth/setup wizard rendered when not ready |
| `test/slack.service.spec.ts` | Unit tests for SlackService |
| `test/mempalace.service.spec.ts` | Unit tests for MempalaceService |
| `test/slack-ingestion.service.spec.ts` | Unit tests for SlackIngestionService |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/modules/config.types.ts` | Add `OracleConfig`, `SlackCredentials`; extend `AppConfig` |
| `src/modules/config.service.ts` | Add `getOracleConfig()`, `updateOracleConfig()` methods |
| `src/modules/dependency.types.ts` | Add `SlackDepStatus`, `oracleReady` to `DependencyStatus` |
| `src/modules/dependency.service.ts` | Add Slack checks (token exists, mempalace installed, daemon running) |
| `src/modules/tui.module.ts` | Import `SlackModule` |
| `src/modules/tui.service.ts` | Inject `SlackIngestionService`; expose on bridge |
| `src/modules/tui/bridge.ts` | Add `SlackIngestionService` to `TawtuiBridge`; add `getSlackIngestionService()` |
| `src/modules/tui/app.tsx` | Add Oracle to `TABS`, add `<Match when={activeTab() === 3}>`, key `4` |
| `src/modules/tui/components/status-bar.tsx` | Add Oracle hint to `TAB_HINTS` |
| `src/app.module.ts` | Import `SlackModule`; add `DaemonCommand` to providers |

---

## Phase 1 — Foundation: Config & Dependency Types

### Task 1: Extend Config Types

**Files:**
- Modify: `src/modules/config.types.ts`

- [ ] **Step 1: Read current config.types.ts**

```bash
cat src/modules/config.types.ts
```

- [ ] **Step 2: Add Oracle config types**

Add the following to `src/modules/config.types.ts` (append after the existing `AppConfig` interface):

```typescript
export interface SlackCredentials {
  /** xoxc- session token extracted from Slack browser/desktop */
  xoxcToken: string;
  /** xoxd- cookie value extracted from Slack browser/desktop */
  xoxdCookie: string;
  /** Slack workspace/team ID (e.g. "T012AB3CD") */
  teamId: string;
  /** Slack workspace name for display */
  teamName: string;
}

export interface OracleConfig {
  /** Slack session credentials — set via setup wizard */
  slack?: SlackCredentials;
  /** How often the daemon polls Slack in seconds (default: 300 = 5 min) */
  pollIntervalSeconds: number;
  /** Taskwarrior project to assign Oracle-created tasks */
  defaultProject?: string;
}

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  pollIntervalSeconds: 300,
};
```

Also extend `AppConfig`:

```typescript
export interface AppConfig {
  repos: import('../shared/types').RepoConfig[];
  preferences: UserPreferences;
  agents?: { types: AgentDefinition[] };
  projectAgentConfigs?: ProjectAgentConfig[];
  calendar?: CalendarConfig;
  oracle?: OracleConfig; // ← add this line
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to oracle).

- [ ] **Step 4: Commit**

```bash
git add src/modules/config.types.ts
git commit -m "feat(oracle): add OracleConfig and SlackCredentials types"
```

---

### Task 2: Extend Dependency Types

**Files:**
- Modify: `src/modules/dependency.types.ts`

- [ ] **Step 1: Read current dependency.types.ts**

```bash
cat src/modules/dependency.types.ts
```

- [ ] **Step 2: Add Slack dependency status types**

Replace the contents of `src/modules/dependency.types.ts` with:

```typescript
export interface DepStatus {
  installed: boolean;
  instructions: string;
}

export interface GhDepStatus extends DepStatus {
  authenticated: boolean;
  authInstructions: string;
}

export interface GogDepStatus extends DepStatus {
  authenticated: boolean;
  authInstructions: string;
  hasCredentials: boolean;
  credentialsPath: string;
}

export interface SlackDepStatus {
  /** xoxc + xoxd tokens exist in config */
  hasTokens: boolean;
  /** mempalace CLI is available (python3 -m mempalace) */
  mempalaceInstalled: boolean;
  /** tawtui daemon is running (pid file exists and process is alive) */
  daemonRunning: boolean;
  /** slacktokens Python package is available for auto-extraction */
  slacktokensInstalled: boolean;
  /** Install instruction for mempalace */
  mempalaceInstallInstructions: string;
  /** Install instruction for slacktokens */
  slacktokensInstallInstructions: string;
  /** Path where the daemon PID file is stored */
  daemonPidPath: string;
}

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  slack: SlackDepStatus;  // ← new
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  oracleReady: boolean;  // ← new: true when hasTokens + mempalaceInstalled + daemonRunning
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: errors about `DependencyService` not returning `slack` and `oracleReady` yet — that is expected and will be fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/modules/dependency.types.ts
git commit -m "feat(oracle): add SlackDepStatus and oracleReady to DependencyStatus"
```

---

### Task 3: Extend ConfigService

**Files:**
- Modify: `src/modules/config.service.ts`

- [ ] **Step 1: Read current config.service.ts**

```bash
cat src/modules/config.service.ts
```

- [ ] **Step 2: Write the failing test**

Create or append to `test/config.service.spec.ts`:

```typescript
import { ConfigService } from '../src/modules/config.service';
import { DEFAULT_ORACLE_CONFIG } from '../src/modules/config.types';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigService - Oracle', () => {
  let service: ConfigService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-test-'));
    // ConfigService reads from ~/.config/tawtui/config.json
    // Pass a custom path via constructor if the service supports it,
    // or mock the home directory. Check existing tests for the pattern used.
    service = new ConfigService();
    // Override config path for tests:
    (service as any).configPath = join(tmpDir, 'config.json');
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({ repos: [], preferences: { theme: 'default', archiveTime: 'midnight', defaultFilter: 'status:pending' } }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_ORACLE_CONFIG when oracle section is absent', () => {
    const config = service.getOracleConfig();
    expect(config).toEqual(DEFAULT_ORACLE_CONFIG);
  });

  it('returns stored oracle config when present', () => {
    const stored = { pollIntervalSeconds: 120, defaultProject: 'Work' };
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({ repos: [], preferences: { theme: 'default', archiveTime: 'midnight', defaultFilter: 'status:pending' }, oracle: stored }),
    );
    const config = service.getOracleConfig();
    expect(config.pollIntervalSeconds).toBe(120);
    expect(config.defaultProject).toBe('Work');
  });

  it('updateOracleConfig merges partial updates', () => {
    service.updateOracleConfig({ pollIntervalSeconds: 60 });
    const config = service.getOracleConfig();
    expect(config.pollIntervalSeconds).toBe(60);
  });

  it('updateOracleConfig persists slack credentials', () => {
    const creds = {
      xoxcToken: 'xoxc-test-token',
      xoxdCookie: 'xoxd-test-cookie',
      teamId: 'T012AB3CD',
      teamName: 'Test Workspace',
    };
    service.updateOracleConfig({ slack: creds });
    const config = service.getOracleConfig();
    expect(config.slack).toEqual(creds);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test test/config.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `service.getOracleConfig is not a function`

- [ ] **Step 4: Add getOracleConfig and updateOracleConfig to ConfigService**

Find the `getCalendarConfig` and `updateCalendarConfig` methods in `src/modules/config.service.ts` and add these methods immediately after them:

```typescript
getOracleConfig(): OracleConfig {
  const config = this.load();
  return { ...DEFAULT_ORACLE_CONFIG, ...config.oracle };
}

updateOracleConfig(update: Partial<OracleConfig>): void {
  const config = this.load();
  config.oracle = { ...DEFAULT_ORACLE_CONFIG, ...config.oracle, ...update };
  this.save(config);
}
```

Also add the import at the top of the file:

```typescript
import type { /* existing imports */, OracleConfig } from './config.types';
import { /* existing imports */, DEFAULT_ORACLE_CONFIG } from './config.types';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test test/config.service.spec.ts 2>&1 | tail -20
```

Expected: PASS (4 tests passing)

- [ ] **Step 6: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/config.service.ts src/modules/config.types.ts test/config.service.spec.ts
git commit -m "feat(oracle): add getOracleConfig and updateOracleConfig to ConfigService"
```

---

### Task 4: Extend DependencyService with Slack Checks

**Files:**
- Modify: `src/modules/dependency.service.ts`

The DependencyService checks whether required tools are installed and authenticated. For Oracle, it needs to check:
1. Whether `~/.config/tawtui/config.json` has `oracle.slack` credentials
2. Whether `mempalace` is available (`python3 -m mempalace --version`)
3. Whether the daemon PID file exists at `~/.local/share/tawtui/daemon.pid` and the process is alive
4. Whether `slacktokens` is available (`python3 -m slacktokens --version`)

- [ ] **Step 1: Read current dependency.service.ts**

```bash
cat src/modules/dependency.service.ts
```

- [ ] **Step 2: Write the failing test**

Create `test/dependency.service.spec.ts` (append oracle-specific tests if file exists):

```typescript
import { DependencyService } from '../src/modules/dependency.service';
import { ConfigService } from '../src/modules/config.service';
import { GithubService } from '../src/modules/github.service';
import { TaskwarriorService } from '../src/modules/taskwarrior.service';
import { CalendarService } from '../src/modules/calendar.service';

describe('DependencyService - Oracle checks', () => {
  let service: DependencyService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      getOracleConfig: jest.fn().mockReturnValue({ pollIntervalSeconds: 300 }),
    } as any;

    service = new DependencyService(
      {} as GithubService,
      {} as TaskwarriorService,
      {} as CalendarService,
      mockConfigService,
    );
  });

  it('oracleReady is false when no slack tokens', async () => {
    const status = await service.checkAll();
    expect(status.slack.hasTokens).toBe(false);
    expect(status.oracleReady).toBe(false);
  });

  it('oracleReady is false when tokens exist but mempalace not installed', async () => {
    mockConfigService.getOracleConfig.mockReturnValue({
      pollIntervalSeconds: 300,
      slack: {
        xoxcToken: 'xoxc-xxx',
        xoxdCookie: 'xoxd-xxx',
        teamId: 'T123',
        teamName: 'Test',
      },
    });
    const status = await service.checkAll();
    // mempalace likely not installed in test env
    expect(status.oracleReady).toBe(status.slack.hasTokens && status.slack.mempalaceInstalled && status.slack.daemonRunning);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun run test test/dependency.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — DependencyService constructor doesn't accept ConfigService, `checkAll` doesn't return `slack` or `oracleReady`

- [ ] **Step 4: Update DependencyService**

Replace `src/modules/dependency.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { GithubService } from './github.service';
import { TaskwarriorService } from './taskwarrior.service';
import { CalendarService } from './calendar.service';
import { ConfigService } from './config.service';
import type { DependencyStatus, SlackDepStatus } from './dependency.types';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

@Injectable()
export class DependencyService {
  private readonly daemonPidPath = join(
    homedir(),
    '.local',
    'share',
    'tawtui',
    'daemon.pid',
  );

  constructor(
    private readonly githubService: GithubService,
    private readonly taskwarriorService: TaskwarriorService,
    private readonly calendarService: CalendarService,
    private readonly configService: ConfigService,
  ) {}

  async checkAll(): Promise<DependencyStatus> {
    const platform = process.platform;
    const taskInstalled = this.taskwarriorService.isInstalled();

    const [
      ghInstalled,
      ghAuthenticated,
      gogInstalled,
      gogAuthenticated,
      gogHasCredentials,
    ] = await Promise.all([
      this.githubService.isGhInstalled(),
      this.githubService.isAuthenticated(),
      this.calendarService.isInstalled(),
      this.calendarService.isAuthenticated(),
      this.calendarService.hasCredentials(),
    ]);

    const gogCredentialsPath = this.calendarService.getCredentialsPath();
    const slackStatus = await this.checkSlack(platform);

    return {
      gh: {
        installed: ghInstalled,
        instructions: this.getGhInstallInstructions(platform),
        authenticated: ghAuthenticated,
        authInstructions: 'gh auth login',
      },
      gog: {
        installed: gogInstalled,
        instructions: this.getGogInstallInstructions(platform),
        authenticated: gogAuthenticated,
        authInstructions: 'gog auth add you@gmail.com',
        hasCredentials: gogHasCredentials,
        credentialsPath: gogCredentialsPath,
      },
      task: {
        installed: taskInstalled,
        instructions: this.getTaskInstallInstructions(platform),
      },
      slack: slackStatus,
      platform,
      allGood: ghInstalled && ghAuthenticated && taskInstalled,
      calendarReady: gogInstalled && gogAuthenticated && gogHasCredentials,
      oracleReady:
        slackStatus.hasTokens &&
        slackStatus.mempalaceInstalled &&
        slackStatus.daemonRunning,
    };
  }

  private async checkSlack(platform: NodeJS.Platform): Promise<SlackDepStatus> {
    const oracleConfig = this.configService.getOracleConfig();
    const hasTokens =
      !!oracleConfig.slack?.xoxcToken && !!oracleConfig.slack?.xoxdCookie;

    const [mempalaceInstalled, slacktokensInstalled, daemonRunning] =
      await Promise.all([
        this.isPythonPackageAvailable('mempalace'),
        this.isPythonPackageAvailable('slacktokens'),
        this.isDaemonRunning(),
      ]);

    return {
      hasTokens,
      mempalaceInstalled,
      slacktokensInstalled,
      daemonRunning,
      mempalaceInstallInstructions: 'pip install mempalace',
      slacktokensInstallInstructions: 'pip install slacktokens',
      daemonPidPath: this.daemonPidPath,
    };
  }

  private async isPythonPackageAvailable(pkg: string): Promise<boolean> {
    const result = Bun.spawnSync(['python3', '-m', pkg, '--version'], {
      stderr: 'pipe',
      stdout: 'pipe',
    });
    return result.exitCode === 0;
  }

  private isDaemonRunning(): boolean {
    if (!existsSync(this.daemonPidPath)) return false;
    try {
      const pid = parseInt(readFileSync(this.daemonPidPath, 'utf-8').trim(), 10);
      if (isNaN(pid)) return false;
      // Send signal 0 to check if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private getGhInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin': return 'brew install gh';
      case 'linux': return 'sudo apt install gh';
      default: return 'See https://cli.github.com for installation instructions';
    }
  }

  private getTaskInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin': return 'brew install task';
      case 'linux': return 'sudo apt install taskwarrior';
      default: return 'See https://taskwarrior.org for installation instructions';
    }
  }

  private getGogInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin': return 'brew install steipete/tap/gogcli';
      case 'linux': return 'go install github.com/steipete/gogcli@latest';
      default: return 'See https://github.com/steipete/gogcli for installation instructions';
    }
  }
}
```

**Important:** Also update `src/modules/dependency.module.ts` to inject `ConfigModule`:

```typescript
import { Module } from '@nestjs/common';
import { DependencyService } from './dependency.service';
import { GithubModule } from './github.module';
import { TaskwarriorModule } from './taskwarrior.module';
import { CalendarModule } from './calendar.module';
import { ConfigModule } from './config.module';

@Module({
  imports: [GithubModule, TaskwarriorModule, CalendarModule, ConfigModule],
  providers: [DependencyService],
  exports: [DependencyService],
})
export class DependencyModule {}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test test/dependency.service.spec.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 6: Run full test suite to catch regressions**

```bash
bun run test 2>&1 | tail -30
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/dependency.service.ts src/modules/dependency.module.ts test/dependency.service.spec.ts
git commit -m "feat(oracle): extend DependencyService with Slack/Oracle readiness checks"
```

---

## Phase 2 — Slack Ingestion Backend

### Task 5: Slack Types

**Files:**
- Create: `src/modules/slack/slack.types.ts`

- [ ] **Step 1: Create the slack directory and types file**

```typescript
// src/modules/slack/slack.types.ts

/** A single message from a Slack conversation */
export interface SlackMessage {
  /** Slack message timestamp (also serves as unique ID within a channel) */
  ts: string;
  /** Slack user ID of the sender (e.g. "U012AB3CD") */
  userId: string;
  /** Display name of the sender (resolved separately) */
  userName: string;
  /** Channel or DM ID where the message was sent */
  channelId: string;
  /** Human-readable channel name (e.g. "#engineering" or "DM:John") */
  channelName: string;
  /** Plain text content of the message */
  text: string;
  /** ISO 8601 timestamp derived from ts */
  isoTimestamp: string;
  /** Whether this is a direct message */
  isDm: boolean;
}

/** A Slack conversation (channel, DM, group DM) the user is a member of */
export interface SlackConversation {
  id: string;
  name: string;
  isDm: boolean;
  isPrivate: boolean;
}

/** Paginated response from Slack conversations.list */
export interface SlackConversationListResponse {
  ok: boolean;
  channels: Array<{
    id: string;
    name?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    user?: string; // For DMs: the other user's ID
  }>;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

/** Paginated response from Slack conversations.history */
export interface SlackHistoryResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string; // 'bot_message', 'channel_join', etc. — filter these out
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

/** Response from Slack users.info */
export interface SlackUserInfoResponse {
  ok: boolean;
  user?: {
    id: string;
    real_name?: string;
    name?: string;
    profile?: { display_name?: string; real_name?: string };
  };
  error?: string;
}

/** State persisted to ~/.config/tawtui/oracle-state.json */
export interface OracleState {
  /** ISO 8601 timestamp of the last successful ingestion */
  lastChecked: string | null;
  /** Map of channel ID → last message ts processed */
  channelCursors: Record<string, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/slack/slack.types.ts
git commit -m "feat(oracle): add Slack API types"
```

---

### Task 6: SlackService — Raw HTTP Client

**Files:**
- Create: `src/modules/slack/slack.service.ts`
- Create: `test/slack.service.spec.ts`

SlackService makes HTTP requests to the Slack Web API using xoxc session tokens + xoxd cookies. The standard `@slack/web-api` SDK does not support this auth pattern, so we use raw `fetch()` calls. Every request includes an `Authorization: Bearer xoxc-...` header and a `Cookie: d=xoxd-...` header.

- [ ] **Step 1: Write the failing test**

```typescript
// test/slack.service.spec.ts
import { SlackService } from '../src/modules/slack/slack.service';
import { ConfigService } from '../src/modules/config.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockConfigService = {
  getOracleConfig: jest.fn().mockReturnValue({
    pollIntervalSeconds: 300,
    slack: {
      xoxcToken: 'xoxc-test',
      xoxdCookie: 'xoxd-test',
      teamId: 'T123',
      teamName: 'Test',
    },
  }),
} as any;

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(() => {
    service = new SlackService(mockConfigService);
    mockFetch.mockReset();
  });

  it('getConversations returns mapped conversations', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        ok: true,
        channels: [
          { id: 'C123', name: 'general', is_im: false, is_private: false },
          { id: 'D456', is_im: true, user: 'U789' },
        ],
        response_metadata: { next_cursor: '' },
      }),
    });

    const convos = await service.getConversations();
    expect(convos).toHaveLength(2);
    expect(convos[0]).toMatchObject({ id: 'C123', name: 'general', isDm: false });
    expect(convos[1]).toMatchObject({ id: 'D456', isDm: true });
  });

  it('getConversations sends correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, channels: [], response_metadata: {} }),
    });

    await service.getConversations();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('conversations.list');
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer xoxc-test');
    expect((options.headers as Record<string, string>)['Cookie']).toBe('d=xoxd-test');
  });

  it('getMessagesSince returns only messages after the given timestamp', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000200.000000', user: 'U123', text: 'hello' },
          { ts: '1700000100.000000', user: 'U456', text: 'world', subtype: 'channel_join' },
        ],
        has_more: false,
      }),
    });

    const messages = await service.getMessagesSince('C123', '1700000000.000000');
    // Should filter out subtype messages
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hello');
  });

  it('resolveUserName returns display name from user profile', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        ok: true,
        user: { id: 'U123', profile: { display_name: 'Alfonso' } },
      }),
    });

    const name = await service.resolveUserName('U123');
    expect(name).toBe('Alfonso');
  });

  it('resolveUserName returns fallback when profile has no display_name', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        ok: true,
        user: { id: 'U123', name: 'alfonso.v', profile: { display_name: '' } },
      }),
    });

    const name = await service.resolveUserName('U123');
    expect(name).toBe('alfonso.v');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test test/slack.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `SlackService` does not exist

- [ ] **Step 3: Implement SlackService**

```typescript
// src/modules/slack/slack.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';
import type {
  SlackConversation,
  SlackConversationListResponse,
  SlackHistoryResponse,
  SlackMessage,
  SlackUserInfoResponse,
} from './slack.types';

const SLACK_API = 'https://slack.com/api';

@Injectable()
export class SlackService {
  /** In-memory cache of userId → display name to avoid redundant API calls */
  private readonly userNameCache = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  private getAuthHeaders(): Record<string, string> {
    const oracle = this.configService.getOracleConfig();
    if (!oracle.slack) throw new Error('Slack credentials not configured');
    return {
      Authorization: `Bearer ${oracle.slack.xoxcToken}`,
      Cookie: `d=${oracle.slack.xoxdCookie}`,
      'Content-Type': 'application/json',
    };
  }

  private async slackGet<T>(
    method: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url.toString(), { headers: this.getAuthHeaders() });
    return res.json() as Promise<T>;
  }

  /** Fetch all conversations (channels + DMs) the user is a member of */
  async getConversations(): Promise<SlackConversation[]> {
    const results: SlackConversation[] = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        types: 'public_channel,private_channel,im,mpim',
        exclude_archived: 'true',
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackConversationListResponse>(
        'conversations.list',
        params,
      );

      if (!data.ok) {
        throw new Error(`Slack conversations.list error: ${data.error}`);
      }

      for (const ch of data.channels) {
        results.push({
          id: ch.id,
          name: ch.name ?? ch.user ?? ch.id,
          isDm: !!ch.is_im || !!ch.is_mpim,
          isPrivate: !!ch.is_private || !!ch.is_im,
        });
      }

      cursor = data.response_metadata?.next_cursor ?? '';
    } while (cursor);

    return results;
  }

  /**
   * Fetch messages in a channel newer than `oldestTs`.
   * Filters out system messages (channel_join, bot_message, etc.).
   * Returns messages in chronological order (oldest first).
   */
  async getMessagesSince(
    channelId: string,
    oldestTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string }>> {
    const results: Array<{ ts: string; userId: string; text: string }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        oldest: oldestTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackHistoryResponse>(
        'conversations.history',
        params,
      );

      if (!data.ok) {
        // Some channels may return 'not_in_channel' — skip silently
        if (data.error === 'not_in_channel') return [];
        throw new Error(`Slack conversations.history error: ${data.error}`);
      }

      for (const msg of data.messages) {
        // Filter out system/bot messages
        if (msg.subtype || !msg.user || !msg.text) continue;
        results.push({ ts: msg.ts, userId: msg.user, text: msg.text });
      }

      cursor = data.has_more
        ? (data.response_metadata?.next_cursor ?? '')
        : '';
    } while (cursor);

    // Return chronological order (Slack returns newest-first)
    return results.reverse();
  }

  /** Resolve a Slack user ID to a display name, with in-memory caching */
  async resolveUserName(userId: string): Promise<string> {
    if (this.userNameCache.has(userId)) {
      return this.userNameCache.get(userId)!;
    }

    const data = await this.slackGet<SlackUserInfoResponse>('users.info', {
      user: userId,
    });

    const name =
      data.user?.profile?.display_name ||
      data.user?.profile?.real_name ||
      data.user?.real_name ||
      data.user?.name ||
      userId;

    this.userNameCache.set(userId, name);
    return name;
  }

  /** Build a full SlackMessage with resolved username and channel name */
  async buildMessage(
    raw: { ts: string; userId: string; text: string },
    conversation: SlackConversation,
  ): Promise<SlackMessage> {
    const userName = await this.resolveUserName(raw.userId);
    const unixSeconds = parseFloat(raw.ts);
    const isoTimestamp = new Date(unixSeconds * 1000).toISOString();

    return {
      ts: raw.ts,
      userId: raw.userId,
      userName,
      channelId: conversation.id,
      channelName: conversation.isDm
        ? `DM:${userName}`
        : `#${conversation.name}`,
      text: raw.text,
      isoTimestamp,
      isDm: conversation.isDm,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test test/slack.service.spec.ts 2>&1 | tail -20
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack.service.ts src/modules/slack/slack.types.ts test/slack.service.spec.ts
git commit -m "feat(oracle): add SlackService with xoxc/xoxd auth and conversation polling"
```

---

### Task 7: MempalaceService — Python Bridge

**Files:**
- Create: `src/modules/slack/mempalace.service.ts`
- Create: `test/mempalace.service.spec.ts`

mempalace is a Python-based local memory store. We interact with it by spawning `python3 -m mempalace` as a child process using `Bun.spawnSync`, exactly how `TaskwarriorService` calls the `task` CLI.

**Important:** Verify the exact mempalace CLI interface at https://github.com/milla-jovovich/mempalace before implementing. The commands below follow the mempalace v3.0.0 API based on research. If the interface differs, adjust accordingly.

Mempalace uses a hierarchical "palace" metaphor:
- **Wing** = top-level domain (we use `"slack"`)
- **Room** = sub-domain (we use channel name, e.g. `"general"`)
- **Memory** = individual item stored

- [ ] **Step 1: Write the failing test**

```typescript
// test/mempalace.service.spec.ts
import { MempalaceService } from '../src/modules/slack/mempalace.service';

const mockSpawnSync = jest.fn();
jest.mock('bun', () => ({ spawnSync: mockSpawnSync }), { virtual: true });

describe('MempalaceService', () => {
  let service: MempalaceService;

  beforeEach(() => {
    service = new MempalaceService();
    mockSpawnSync.mockReset();
  });

  it('addMemory calls mempalace with correct wing, room, and content', () => {
    mockSpawnSync.mockReturnValue({ exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') });

    service.addMemory({
      wing: 'slack',
      room: 'general',
      content: '[2026-04-08 10:00] Alfonso: Let\'s ship this on Friday',
    });

    const [cmd, args] = mockSpawnSync.mock.calls[0] as [string[], unknown];
    expect(cmd).toContain('python3');
    expect(args).toBeUndefined(); // Bun.spawnSync takes array as first arg
    // Check the full args array includes wing, room, and content
    expect(cmd).toContain('--wing');
    expect(cmd).toContain('slack');
    expect(cmd).toContain('--room');
    expect(cmd).toContain('general');
  });

  it('isInstalled returns true when mempalace exits 0', () => {
    mockSpawnSync.mockReturnValue({ exitCode: 0, stdout: Buffer.from('mempalace 3.0.0'), stderr: Buffer.from('') });
    expect(service.isInstalled()).toBe(true);
  });

  it('isInstalled returns false when mempalace is not found', () => {
    mockSpawnSync.mockReturnValue({ exitCode: 1, stdout: Buffer.from(''), stderr: Buffer.from('No module named mempalace') });
    expect(service.isInstalled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test test/mempalace.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `MempalaceService` does not exist

- [ ] **Step 3: Implement MempalaceService**

```typescript
// src/modules/slack/mempalace.service.ts
import { Injectable } from '@nestjs/common';

interface AddMemoryOptions {
  /** Top-level namespace — always "slack" for this feature */
  wing: string;
  /** Sub-namespace — channel name or DM identifier */
  room: string;
  /** The memory content to store */
  content: string;
}

@Injectable()
export class MempalaceService {
  private readonly rcOverrides = ['--no-color'];

  /** Check if mempalace Python package is installed */
  isInstalled(): boolean {
    const result = Bun.spawnSync(
      ['python3', '-m', 'mempalace', '--version', ...this.rcOverrides],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return result.exitCode === 0;
  }

  /**
   * Store a memory in mempalace under a specific wing and room.
   * Uses the mempalace CLI: python3 -m mempalace add --wing <wing> --room <room> <content>
   *
   * IMPORTANT: Verify exact CLI flags against mempalace v3.0.0 docs at
   * https://github.com/milla-jovovich/mempalace — adjust if API differs.
   */
  addMemory(opts: AddMemoryOptions): void {
    const result = Bun.spawnSync(
      [
        'python3', '-m', 'mempalace',
        'add',
        '--wing', opts.wing,
        '--room', opts.room,
        opts.content,
        ...this.rcOverrides,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`mempalace add failed: ${stderr}`);
    }
  }

  /**
   * Search mempalace for memories matching a query.
   * Returns raw text output from mempalace.
   *
   * IMPORTANT: Verify exact CLI flags against mempalace v3.0.0 docs.
   */
  search(query: string, wing?: string): string {
    const args = ['python3', '-m', 'mempalace', 'search', query];
    if (wing) args.push('--wing', wing);
    args.push(...this.rcOverrides);

    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });

    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`mempalace search failed: ${stderr}`);
    }

    return new TextDecoder().decode(result.stdout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test test/mempalace.service.spec.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/mempalace.service.ts test/mempalace.service.spec.ts
git commit -m "feat(oracle): add MempalaceService Python subprocess bridge"
```

---

### Task 8: SlackIngestionService — Orchestration

**Files:**
- Create: `src/modules/slack/slack-ingestion.service.ts`
- Create: `test/slack-ingestion.service.spec.ts`

This service is the brain of the daemon. It orchestrates:
1. Loading the last-checked state from `~/.config/tawtui/oracle-state.json`
2. Fetching all conversations the user is in
3. For each conversation, fetching messages since the channel's last cursor
4. Formatting each message and storing it in mempalace
5. Updating the state file with new cursors

- [ ] **Step 1: Write the failing test**

```typescript
// test/slack-ingestion.service.spec.ts
import { SlackIngestionService } from '../src/modules/slack/slack-ingestion.service';
import { SlackService } from '../src/modules/slack/slack.service';
import { MempalaceService } from '../src/modules/slack/mempalace.service';
import type { SlackConversation, SlackMessage } from '../src/modules/slack/slack.types';

const mockSlackService: jest.Mocked<SlackService> = {
  getConversations: jest.fn(),
  getMessagesSince: jest.fn(),
  buildMessage: jest.fn(),
  resolveUserName: jest.fn(),
} as any;

const mockMempalaceService: jest.Mocked<MempalaceService> = {
  addMemory: jest.fn(),
  isInstalled: jest.fn(),
  search: jest.fn(),
} as any;

describe('SlackIngestionService', () => {
  let service: SlackIngestionService;

  beforeEach(() => {
    service = new SlackIngestionService(mockSlackService, mockMempalaceService);
    jest.clearAllMocks();
    // Override state file path for tests
    (service as any).statePath = '/tmp/tawtui-test-oracle-state.json';
  });

  it('ingest fetches conversations and stores messages in mempalace', async () => {
    const conversation: SlackConversation = {
      id: 'C123', name: 'general', isDm: false, isPrivate: false,
    };
    const message: SlackMessage = {
      ts: '1700000200.000000',
      userId: 'U123',
      userName: 'Alfonso',
      channelId: 'C123',
      channelName: '#general',
      text: 'Ship it on Friday',
      isoTimestamp: '2023-11-14T21:36:40.000Z',
      isDm: false,
    };

    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: message.ts, userId: message.userId, text: message.text },
    ]);
    mockSlackService.buildMessage.mockResolvedValue(message);

    await service.ingest();

    expect(mockMempalaceService.addMemory).toHaveBeenCalledWith({
      wing: 'slack',
      room: 'general',
      content: expect.stringContaining('Alfonso'),
    });
    expect(mockMempalaceService.addMemory).toHaveBeenCalledWith({
      wing: 'slack',
      room: 'general',
      content: expect.stringContaining('Ship it on Friday'),
    });
  });

  it('ingest skips channels with no new messages', async () => {
    const conversation: SlackConversation = {
      id: 'C123', name: 'general', isDm: false, isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getMessagesSince.mockResolvedValue([]);

    await service.ingest();

    expect(mockMempalaceService.addMemory).not.toHaveBeenCalled();
  });

  it('formats DM messages with DM prefix in room name', async () => {
    const dmConversation: SlackConversation = {
      id: 'D456', name: 'victor', isDm: true, isPrivate: true,
    };
    const dmMessage: SlackMessage = {
      ts: '1700000200.000000',
      userId: 'U456',
      userName: 'Victor',
      channelId: 'D456',
      channelName: 'DM:Victor',
      text: 'Can you review my PR?',
      isoTimestamp: '2023-11-14T21:36:40.000Z',
      isDm: true,
    };

    mockSlackService.getConversations.mockResolvedValue([dmConversation]);
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: dmMessage.ts, userId: dmMessage.userId, text: dmMessage.text },
    ]);
    mockSlackService.buildMessage.mockResolvedValue(dmMessage);

    await service.ingest();

    expect(mockMempalaceService.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({ room: 'dm-victor' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test test/slack-ingestion.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `SlackIngestionService` does not exist

- [ ] **Step 3: Implement SlackIngestionService**

```typescript
// src/modules/slack/slack-ingestion.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import type { OracleState } from './slack.types';

@Injectable()
export class SlackIngestionService {
  private readonly logger = new Logger(SlackIngestionService.name);
  private readonly statePath = join(
    homedir(),
    '.config',
    'tawtui',
    'oracle-state.json',
  );

  constructor(
    private readonly slackService: SlackService,
    private readonly mempalaceService: MempalaceService,
  ) {}

  /** Run one full ingestion cycle: fetch → store → update state */
  async ingest(): Promise<{ messagesStored: number }> {
    const state = this.loadState();
    const conversations = await this.slackService.getConversations();
    let messagesStored = 0;

    for (const conversation of conversations) {
      const cursor = state.channelCursors[conversation.id] ?? '0';

      let rawMessages: Array<{ ts: string; userId: string; text: string }>;
      try {
        rawMessages = await this.slackService.getMessagesSince(
          conversation.id,
          cursor,
        );
      } catch (err) {
        this.logger.warn(
          `Skipping channel ${conversation.id}: ${(err as Error).message}`,
        );
        continue;
      }

      if (rawMessages.length === 0) continue;

      for (const raw of rawMessages) {
        const message = await this.slackService.buildMessage(raw, conversation);
        const room = this.roomName(conversation.name, conversation.isDm);
        const content = this.formatMemory(message);

        this.mempalaceService.addMemory({ wing: 'slack', room, content });
        messagesStored++;

        // Advance cursor to newest processed message ts
        state.channelCursors[conversation.id] = raw.ts;
      }
    }

    state.lastChecked = new Date().toISOString();
    this.saveState(state);

    this.logger.log(`Ingestion complete: ${messagesStored} messages stored`);
    return { messagesStored };
  }

  /** Format a message into a plain text memory string */
  private formatMemory(message: {
    isoTimestamp: string;
    userName: string;
    channelName: string;
    text: string;
  }): string {
    const date = message.isoTimestamp.slice(0, 16).replace('T', ' ');
    return `[${date}] ${message.userName} in ${message.channelName}: ${message.text}`;
  }

  /** Normalise a room name for mempalace (lowercase, no spaces, dm- prefix for DMs) */
  private roomName(name: string, isDm: boolean): string {
    const normalised = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return isDm ? `dm-${normalised}` : normalised;
  }

  private loadState(): OracleState {
    if (!existsSync(this.statePath)) {
      return { lastChecked: null, channelCursors: {} };
    }
    try {
      return JSON.parse(readFileSync(this.statePath, 'utf-8')) as OracleState;
    } catch {
      return { lastChecked: null, channelCursors: {} };
    }
  }

  private saveState(state: OracleState): void {
    const dir = join(homedir(), '.config', 'tawtui');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test test/slack-ingestion.service.spec.ts 2>&1 | tail -20
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/slack-ingestion.service.ts test/slack-ingestion.service.spec.ts
git commit -m "feat(oracle): add SlackIngestionService with polling and mempalace storage"
```

---

### Task 9: SlackModule

**Files:**
- Create: `src/modules/slack/slack.module.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/modules/slack/slack.module.ts
import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import { SlackIngestionService } from './slack-ingestion.service';
import { ConfigModule } from '../config.module';

@Module({
  imports: [ConfigModule],
  providers: [SlackService, MempalaceService, SlackIngestionService],
  exports: [SlackService, MempalaceService, SlackIngestionService],
})
export class SlackModule {}
```

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/slack/slack.module.ts
git commit -m "feat(oracle): add SlackModule"
```

---

## Phase 3 — Daemon Command

The daemon runs `SlackIngestionService.ingest()` on a cron schedule. It is a separate NestJS application entry point (`tawtui daemon`) that does NOT load TUI services — it only needs `SlackModule` and `ConfigModule`. It writes a PID file to `~/.local/share/tawtui/daemon.pid` so the `DependencyService` can check if it's running.

### Task 10: Add @nestjs/schedule and DaemonModule

**Files:**
- Create: `src/modules/daemon.module.ts`
- Modify: `package.json` (add `@nestjs/schedule`)

- [ ] **Step 1: Install @nestjs/schedule**

```bash
bun add @nestjs/schedule
```

Expected: `@nestjs/schedule` added to package.json dependencies.

- [ ] **Step 2: Create DaemonModule**

```typescript
// src/modules/daemon.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SlackModule } from './slack/slack.module';
import { ConfigModule } from './config.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    SlackModule,
  ],
})
export class DaemonModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/daemon.module.ts package.json bun.lock
git commit -m "feat(oracle): add DaemonModule with @nestjs/schedule"
```

---

### Task 11: DaemonCommand

**Files:**
- Create: `src/commands/daemon.command.ts`

The daemon command:
1. Writes its PID to `~/.local/share/tawtui/daemon.pid`
2. Registers a cron job that calls `SlackIngestionService.ingest()` every N seconds (from config)
3. Logs progress to stdout
4. Removes the PID file on clean exit (SIGINT/SIGTERM)

- [ ] **Step 1: Create daemon.command.ts**

```typescript
// src/commands/daemon.command.ts
import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { join } from 'path';
import { homedir } from 'os';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { SlackIngestionService } from '../modules/slack/slack-ingestion.service';
import { ConfigService } from '../modules/config.service';

@Injectable()
@Command({
  name: 'daemon',
  description: 'Run the Oracle background ingestion daemon',
})
export class DaemonCommand extends CommandRunner {
  private readonly logger = new Logger(DaemonCommand.name);
  private readonly pidDir = join(homedir(), '.local', 'share', 'tawtui');
  private readonly pidPath = join(this.pidDir, 'daemon.pid');

  constructor(
    private readonly slackIngestionService: SlackIngestionService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    super();
  }

  async run(): Promise<void> {
    this.writePid();
    this.registerShutdown();

    const oracle = this.configService.getOracleConfig();
    const intervalSeconds = oracle.pollIntervalSeconds;

    this.logger.log(`Oracle daemon started. Poll interval: ${intervalSeconds}s`);
    this.logger.log(`PID ${process.pid} written to ${this.pidPath}`);

    // Run once immediately on startup
    await this.runIngestion();

    // Schedule subsequent runs
    const cronExpression = this.secondsToCron(intervalSeconds);
    const job = new CronJob(cronExpression, () => {
      void this.runIngestion();
    });

    this.schedulerRegistry.addCronJob('slack-ingestion', job);
    job.start();

    this.logger.log(`Next run in ${intervalSeconds}s (cron: ${cronExpression})`);

    // Keep process alive indefinitely
    await new Promise<void>(() => {
      // Resolved only via SIGINT/SIGTERM handlers registered in registerShutdown()
    });
  }

  private async runIngestion(): Promise<void> {
    try {
      this.logger.log('Starting Slack ingestion...');
      const { messagesStored } = await this.slackIngestionService.ingest();
      this.logger.log(`Ingestion complete: ${messagesStored} new messages stored`);
    } catch (err) {
      this.logger.error('Ingestion failed:', (err as Error).message);
    }
  }

  private writePid(): void {
    mkdirSync(this.pidDir, { recursive: true });
    writeFileSync(this.pidPath, String(process.pid), 'utf-8');
  }

  private removePid(): void {
    if (existsSync(this.pidPath)) {
      try { unlinkSync(this.pidPath); } catch { /* ignore */ }
    }
  }

  private registerShutdown(): void {
    const shutdown = (signal: string) => {
      this.logger.log(`Received ${signal}, shutting down daemon`);
      this.removePid();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /** Convert a polling interval in seconds to a cron expression */
  private secondsToCron(seconds: number): string {
    if (seconds < 60) return `*/${seconds} * * * * *`; // every N seconds
    const minutes = Math.floor(seconds / 60);
    return `0 */${minutes} * * * *`; // every N minutes at :00
  }
}
```

- [ ] **Step 2: Wire DaemonCommand into AppModule**

Modify `src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TuiCommand } from './commands/tui.command';
import { DaemonCommand } from './commands/daemon.command';
import { ConfigModule } from './modules/config.module';
import { TuiModule } from './modules/tui.module';
import { DaemonModule } from './modules/daemon.module';
import { SlackModule } from './modules/slack/slack.module';

@Module({
  imports: [ConfigModule, TuiModule, DaemonModule, SlackModule],
  providers: [TuiCommand, DaemonCommand],
})
export class AppModule {}
```

- [ ] **Step 3: Build and verify the daemon command is registered**

```bash
bun run build && ./dist/main daemon --help 2>&1
```

Expected: Help text for the `daemon` command showing description "Run the Oracle background ingestion daemon"

- [ ] **Step 4: Commit**

```bash
git add src/commands/daemon.command.ts src/app.module.ts src/modules/daemon.module.ts
git commit -m "feat(oracle): add tawtui daemon command with cron-based Slack ingestion"
```

---

## Phase 4 — Oracle Session in TerminalService

### Task 12: Add createOracleSession to TerminalService

**Files:**
- Modify: `src/modules/terminal.service.ts`
- Modify: `src/modules/terminal.types.ts`

The Oracle Claude session is a tmux session (same as PR reviews) that runs Claude Code with a specific loop prompt. It reads mempalace via the MCP server and creates Taskwarrior tasks.

- [ ] **Step 1: Add oracleSessionId to TerminalSession type**

In `src/modules/terminal.types.ts`, add an optional field to `TerminalSession`:

```typescript
export interface TerminalSession {
  id: string;
  tmuxSessionName: string;
  tmuxPaneId: string;
  name: string;
  cwd: string;
  command?: string;
  status: 'running' | 'done' | 'failed';
  createdAt: Date;
  prNumber?: number;
  repoOwner?: string;
  repoName?: string;
  worktreeId?: string;
  worktreePath?: string;
  branchName?: string;
  isOracleSession?: boolean; // ← add this
}
```

- [ ] **Step 2: Add createOracleSession to TerminalService**

Find the `createPrReviewSession` method in `src/modules/terminal.service.ts`. Add the following method immediately after it:

```typescript
async createOracleSession(): Promise<{ sessionId: string }> {
  const agentTypes = this.configService.getAgentTypes();
  const claudeAgent = agentTypes.find((a) => a.id === 'claude-code') ?? agentTypes[0];

  if (!claudeAgent?.command) {
    throw new Error('Claude Code agent not configured. Add it under agents.types in ~/.config/tawtui/config.json');
  }

  const oraclePrompt = [
    'You are Oracle, a personal assistant integrated into tawtui.',
    '',
    'Your job is to monitor my Slack conversations (stored in mempalace) and surface',
    'action items as Taskwarrior tasks.',
    '',
    'On each run:',
    '1. Use the mempalace MCP server to query recent messages in the "slack" wing.',
    '2. Identify action items, commitments, follow-ups, and deadlines.',
    '3. Before creating any task, run: task list +oracle and check for similar',
    '   existing tasks to avoid duplicates.',
    '4. Create tasks with: task add "<description>" +oracle +slack',
    '   Optionally add due dates: task add "<description>" +oracle +slack due:2026-04-10',
    '5. After processing, briefly summarise: N tasks created, key highlights.',
    '',
    'Focus on:',
    '- Direct commitments ("I will send you X", "I\'ll review that by Y")',
    '- Requests directed at you that need a response or action',
    '- Deadlines or time-sensitive items mentioned',
    '',
    'Use /loop 5m to repeat this check every 5 minutes.',
  ].join('\n');

  const escaped = oraclePrompt.replace(/'/g, "'\\''");
  let command = claudeAgent.command;
  if (claudeAgent.autoApproveFlag) {
    command += ` ${claudeAgent.autoApproveFlag}`;
  }
  command += ` '${escaped}'`;

  const session = await this.createSession({
    name: 'Oracle',
    cwd: process.env.HOME ?? process.cwd(),
    command,
  });

  // Tag for easy identification
  const sessionData = this.sessions.get(session.id);
  if (sessionData) {
    sessionData.isOracleSession = true;
    this.persistSessions();
  }

  return { sessionId: session.id };
}
```

- [ ] **Step 3: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/terminal.service.ts src/modules/terminal.types.ts
git commit -m "feat(oracle): add createOracleSession to TerminalService"
```

---

### Task 13: Extend Bridge

**Files:**
- Modify: `src/modules/tui.service.ts`
- Modify: `src/modules/tui/bridge.ts`
- Modify: `src/modules/tui.module.ts`

- [ ] **Step 1: Add SlackIngestionService to TuiModule**

In `src/modules/tui.module.ts`, import `SlackModule`:

```typescript
import { Module } from '@nestjs/common';
import { TuiService } from './tui.service';
import { TaskwarriorModule } from './taskwarrior.module';
import { GithubModule } from './github.module';
import { TerminalModule } from './terminal.module';
import { DependencyModule } from './dependency.module';
import { CalendarModule } from './calendar.module';
import { SlackModule } from './slack/slack.module';

@Module({
  imports: [
    TaskwarriorModule,
    GithubModule,
    TerminalModule,
    DependencyModule,
    CalendarModule,
    SlackModule,
  ],
  providers: [TuiService],
  exports: [TuiService],
})
export class TuiModule {}
```

- [ ] **Step 2: Inject SlackIngestionService into TuiService**

In `src/modules/tui.service.ts`:

Add to the constructor:
```typescript
import { SlackIngestionService } from './slack/slack-ingestion.service';

// In constructor:
constructor(
  private readonly taskwarriorService: TaskwarriorService,
  private readonly githubService: GithubService,
  private readonly configService: ConfigService,
  private readonly terminalService: TerminalService,
  private readonly dependencyService: DependencyService,
  private readonly calendarService: CalendarService,
  private readonly slackIngestionService: SlackIngestionService, // ← add
) {}
```

Add to `g.__tawtui` object in `launch()`:
```typescript
g.__tawtui = {
  // ... existing fields ...
  slackIngestionService: this.slackIngestionService,
  createOracleSession: () => this.terminalService.createOracleSession(),
};
```

Also update the `TawtuiGlobal` interface at the top of tui.service.ts to include:
```typescript
slackIngestionService: SlackIngestionService;
createOracleSession: () => Promise<{ sessionId: string }>;
```

- [ ] **Step 3: Extend bridge.ts**

In `src/modules/tui/bridge.ts`:

Add to the `TawtuiBridge` interface:
```typescript
import type { SlackIngestionService } from '../slack/slack-ingestion.service';

// In TawtuiBridge:
slackIngestionService: SlackIngestionService;
createOracleSession: () => Promise<{ sessionId: string }>;
```

Add accessor functions at the bottom of the file:
```typescript
export function getSlackIngestionService(): SlackIngestionService | null {
  return getBridge()?.slackIngestionService ?? null;
}

export function getCreateOracleSession():
  | TawtuiBridge['createOracleSession']
  | null {
  return getBridge()?.createOracleSession ?? null;
}
```

- [ ] **Step 4: Verify build**

```bash
bun run build 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/tui.module.ts src/modules/tui.service.ts src/modules/tui/bridge.ts
git commit -m "feat(oracle): expose SlackIngestionService and createOracleSession via TUI bridge"
```

---

## Phase 5 — Oracle TUI

The Oracle TUI tab has two states controlled by a single computed signal:

```
oracleReady signal (from DependencyService)
  → false: render <OracleSetupScreen />
  → true: render <OracleSessionView /> (Claude tmux session)
```

### Task 14: OracleSetupScreen Component

**Files:**
- Create: `src/modules/tui/components/oracle-setup-screen.tsx`

The setup screen renders inline (not as a dialog) with step-by-step auth instructions. It follows the `DialogSetupWizard` visual style. Each step shows ✓/✗ and contextual instructions.

Steps:
1. **Slack Tokens** — extract via `slacktokens` or manual browser devtools
2. **mempalace** — `pip install mempalace`
3. **Daemon** — `tawtui daemon` (show copy-pasteable command)

- [ ] **Step 1: Create oracle-setup-screen.tsx**

```typescript
// src/modules/tui/components/oracle-setup-screen.tsx
import { createSignal, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { SlackDepStatus } from '../../dependency.types';
import { getDependencyService, getConfigService } from '../bridge';
import {
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARNING,
  ACCENT_PRIMARY,
  SEPARATOR_COLOR,
  P,
} from '../theme';
import { lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

// Oracle gradient: purple → indigo
export const ORACLE_GRAD: [string, string] = [P.purple, P.secondary];

interface OracleSetupScreenProps {
  slackStatus: SlackDepStatus;
  onRecheck: () => Promise<void>;
  onTokensSubmit: (xoxc: string, xoxd: string, teamId: string, teamName: string) => Promise<void>;
}

export function OracleSetupScreen(props: OracleSetupScreenProps) {
  const [checking, setChecking] = createSignal(false);
  const [tokenInput, setTokenInput] = createSignal(false);
  const [xoxcValue, setXoxcValue] = createSignal('');
  const [xoxdValue, setXoxdValue] = createSignal('');
  const [teamIdValue, setTeamIdValue] = createSignal('');
  const [teamNameValue, setTeamNameValue] = createSignal('');
  const [activeField, setActiveField] = createSignal<'xoxc' | 'xoxd' | 'teamId' | 'teamName'>('xoxc');
  const [statusMsg, setStatusMsg] = createSignal('');

  const allReady = () =>
    props.slackStatus.hasTokens &&
    props.slackStatus.mempalaceInstalled &&
    props.slackStatus.daemonRunning;

  useKeyboard((key) => {
    if (checking()) return;

    if (tokenInput()) {
      handleTokenInput(key);
      return;
    }

    // [R] Re-check status
    if (key.name === 'r') {
      setChecking(true);
      void props.onRecheck().then(() => setChecking(false));
      return;
    }

    // [T] Open token input mode (only if slacktokens not installed or manual preferred)
    if (key.name === 't' && !props.slackStatus.hasTokens) {
      setTokenInput(true);
      return;
    }
  });

  function handleTokenInput(key: { name: string; sequence?: string }) {
    // Tab cycles fields
    if (key.name === 'tab') {
      const fields = ['xoxc', 'xoxd', 'teamId', 'teamName'] as const;
      const idx = fields.indexOf(activeField());
      setActiveField(fields[(idx + 1) % fields.length]);
      return;
    }
    // Escape exits token input
    if (key.name === 'escape') {
      setTokenInput(false);
      return;
    }
    // Enter submits when all fields have values
    if (key.name === 'return') {
      if (xoxcValue() && xoxdValue() && teamIdValue() && teamNameValue()) {
        void props.onTokensSubmit(
          xoxcValue(), xoxdValue(), teamIdValue(), teamNameValue(),
        ).then(() => {
          setTokenInput(false);
          setStatusMsg('Tokens saved! Press [r] to re-check.');
        });
      }
      return;
    }
    // Backspace
    if (key.name === 'backspace') {
      const setters = { xoxc: setXoxcValue, xoxd: setXoxdValue, teamId: setTeamIdValue, teamName: setTeamNameValue };
      setters[activeField()]((v) => v.slice(0, -1));
      return;
    }
    // Printable characters
    if (key.sequence && key.sequence.length === 1 && !key.sequence.match(/[\x00-\x1f]/)) {
      const setters = { xoxc: setXoxcValue, xoxd: setXoxdValue, teamId: setTeamIdValue, teamName: setTeamNameValue };
      setters[activeField()]((v) => v + key.sequence!);
    }
  }

  const gradColor = lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5);

  return (
    <box flexDirection="column" flexGrow={1} width="100%" borderStyle="single" borderColor={gradColor} paddingX={2} paddingY={1}>

      {/* Title */}
      <box height={1} flexDirection="row">
        <text fg={ORACLE_GRAD[0]}>{LEFT_CAP}</text>
        <text fg="#ffffff" bg={lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5)} attributes={1}>{' ORACLE SETUP '}</text>
        <text fg={ORACLE_GRAD[1]}>{RIGHT_CAP}</text>
      </box>
      <box height={1} />

      <text fg={FG_MUTED}>
        {'Oracle monitors your Slack conversations and surfaces action items as tasks.'}
      </text>
      <text fg={FG_MUTED}>
        {'No Slack app required. No admin approval. Uses your existing browser session.'}
      </text>
      <box height={1} />

      {/* Step 1: Slack Tokens */}
      <text fg={FG_NORMAL} attributes={1}>{'Step 1: Slack Session Tokens'}</text>
      <box flexDirection="row">
        <text fg={props.slackStatus.hasTokens ? COLOR_SUCCESS : COLOR_ERROR}>
          {props.slackStatus.hasTokens ? '  ✓' : '  ✗'}
        </text>
        <text fg={FG_DIM}>{' Tokens configured'}</text>
      </box>
      <Show when={!props.slackStatus.hasTokens}>
        <box height={1} />
        <text fg={FG_DIM}>{'  Option A — Automatic (recommended):'}</text>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    '}</text>
          <text fg={props.slackStatus.slacktokensInstalled ? COLOR_SUCCESS : COLOR_WARNING}>
            {props.slackStatus.slacktokensInstalled ? '✓' : '○'}
          </text>
          <text fg={FG_DIM}>{' Install slacktokens: '}</text>
          <text fg={COLOR_WARNING}>{props.slackStatus.slacktokensInstallInstructions}</text>
        </box>
        <Show when={props.slackStatus.slacktokensInstalled}>
          <text fg={FG_DIM}>{'    Then run: python3 -m slacktokens'}</text>
          <text fg={FG_DIM}>{'    Copy the xoxc and xoxd values it prints.'}</text>
        </Show>
        <box height={1} />
        <text fg={FG_DIM}>{'  Option B — Manual (browser devtools):'}</text>
        <text fg={FG_DIM}>{'    1. Open Slack in your browser'}</text>
        <text fg={FG_DIM}>{'    2. DevTools → Application → Cookies → copy "d" value (xoxd-...)'}</text>
        <text fg={FG_DIM}>{"    3. DevTools Console: JSON.parse(localStorage.localConfig_v2)"}</text>
        <text fg={FG_DIM}>{"       .teams → find your workspace → copy 'token' value (xoxc-...)"}</text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>{'  [T]'}</text>
          <text fg={FG_DIM}>{' Enter tokens manually'}</text>
        </box>
      </Show>

      <Show when={tokenInput()}>
        <box height={1} />
        <text fg={FG_NORMAL} attributes={1}>{'  Enter tokens (Tab to switch fields, Enter to save, Esc to cancel):'}</text>
        {(['xoxc', 'xoxd', 'teamId', 'teamName'] as const).map((field) => {
          const labels = { xoxc: 'xoxc token', xoxd: 'xoxd cookie', teamId: 'Team ID', teamName: 'Team name' };
          const values = { xoxc: xoxcValue, xoxd: xoxdValue, teamId: teamIdValue, teamName: teamNameValue };
          const isFocused = () => activeField() === field;
          const displayValue = () => field === 'xoxc' || field === 'xoxd'
            ? (values[field]().length > 20 ? `${values[field]().slice(0, 20)}...` : values[field]())
            : values[field]();
          return (
            <box flexDirection="row">
              <text fg={FG_DIM}>{`    ${labels[field]}: `}</text>
              <text fg={isFocused() ? ACCENT_PRIMARY : FG_NORMAL} attributes={isFocused() ? 1 : 0}>
                {displayValue() || (isFocused() ? '█' : '_')}
              </text>
            </box>
          );
        })}
      </Show>

      <box height={1} />

      {/* Step 2: mempalace */}
      <text fg={FG_NORMAL} attributes={1}>{'Step 2: mempalace (local memory store)'}</text>
      <box flexDirection="row">
        <text fg={props.slackStatus.mempalaceInstalled ? COLOR_SUCCESS : COLOR_ERROR}>
          {props.slackStatus.mempalaceInstalled ? '  ✓' : '  ✗'}
        </text>
        <text fg={FG_DIM}>{' Installed'}</text>
      </box>
      <Show when={!props.slackStatus.mempalaceInstalled}>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    Install: '}</text>
          <text fg={COLOR_WARNING}>{props.slackStatus.mempalaceInstallInstructions}</text>
        </box>
      </Show>

      <box height={1} />

      {/* Step 3: Daemon */}
      <text fg={FG_NORMAL} attributes={1}>{'Step 3: Oracle Daemon'}</text>
      <box flexDirection="row">
        <text fg={props.slackStatus.daemonRunning ? COLOR_SUCCESS : COLOR_ERROR}>
          {props.slackStatus.daemonRunning ? '  ✓' : '  ✗'}
        </text>
        <text fg={FG_DIM}>{' Daemon running'}</text>
      </box>
      <Show when={!props.slackStatus.daemonRunning}>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    Start it in a separate terminal: '}</text>
          <text fg={COLOR_WARNING}>{'tawtui daemon'}</text>
        </box>
      </Show>

      <box height={1} />
      <text fg={SEPARATOR_COLOR}>{'─────────────────────────────'}</text>
      <box height={1} />

      {/* Status message */}
      <Show when={statusMsg()}>
        <text fg={COLOR_SUCCESS} attributes={1}>{`  ${statusMsg()}`}</text>
        <box height={1} />
      </Show>

      {/* Controls */}
      <Show when={checking()}>
        <text fg={FG_MUTED}>{'  Checking...'}</text>
      </Show>
      <Show when={!checking()}>
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>{'  [R]'}</text>
          <text fg={FG_DIM}>{' Re-check all steps'}</text>
        </box>
      </Show>

      <Show when={allReady()}>
        <box height={1} />
        <text fg={COLOR_SUCCESS} attributes={1}>{'  ✓ All steps complete! Refreshing Oracle tab...'}</text>
      </Show>
    </box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/tui/components/oracle-setup-screen.tsx
git commit -m "feat(oracle): add OracleSetupScreen TUI component"
```

---

### Task 15: oracle-view.tsx — The Oracle Tab

**Files:**
- Create: `src/modules/tui/views/oracle-view.tsx`

The Oracle view is the root of the Oracle tab. It:
1. On mount, checks dependency status for Oracle readiness
2. If not ready: renders `<OracleSetupScreen />`
3. If ready: shows an active Claude tmux session (same pattern as reviews tab)
4. Allows the user to spawn a new Oracle session if one isn't running
5. Polls session output every 300ms when a session is active

- [ ] **Step 1: Create oracle-view.tsx**

```typescript
// src/modules/tui/views/oracle-view.tsx
import {
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  Show,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { DependencyStatus } from '../../dependency.types';
import type { CaptureResult } from '../../terminal.types';
import { OracleSetupScreen, ORACLE_GRAD } from '../components/oracle-setup-screen';
import { TerminalOutput } from '../components/terminal-output';
import {
  getDependencyService,
  getTerminalService,
  getConfigService,
  getCreateOracleSession,
} from '../bridge';
import {
  FG_PRIMARY,
  FG_DIM,
  FG_MUTED,
  COLOR_SUCCESS,
  COLOR_ERROR,
  ACCENT_PRIMARY,
} from '../theme';
import { lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

interface OracleViewProps {
  refreshTrigger?: () => number;
  onInputCapturedChange?: (captured: boolean) => void;
}

export function OracleView(props: OracleViewProps) {
  const dimensions = useTerminalDimensions();

  const [depStatus, setDepStatus] = createSignal<DependencyStatus | null>(null);
  const [oracleSessionId, setOracleSessionId] = createSignal<string | null>(null);
  const [capture, setCapture] = createSignal<CaptureResult | null>(null);
  const [interactive, setInteractive] = createSignal(false);
  const [inputBuffer, setInputBuffer] = createSignal('');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollVersion = 0;

  const oracleReady = () => depStatus()?.oracleReady ?? false;
  const slackStatus = () => depStatus()?.slack;

  async function recheckDeps(): Promise<void> {
    const depService = getDependencyService();
    if (!depService) return;
    const status = await depService.checkAll();
    setDepStatus(status);
  }

  onMount(() => {
    void recheckDeps();
    // If there's already an active Oracle session from a previous tab visit, reattach
    const ts = getTerminalService();
    if (ts) {
      const existing = ts
        .listSessions()
        .find((s) => s.isOracleSession && s.status === 'running');
      if (existing) setOracleSessionId(existing.id);
    }
  });

  // Re-check when parent bumps refreshTrigger
  createEffect(
    on(
      () => props.refreshTrigger?.(),
      () => { void recheckDeps(); },
      { defer: true },
    ),
  );

  // Start/stop polling when session changes
  createEffect(
    on(oracleSessionId, (sessionId) => {
      pollVersion++;
      clearTimeout(pollTimer);
      if (sessionId) schedulePoll(pollVersion);
    }),
  );

  onCleanup(() => {
    pollVersion++;
    clearTimeout(pollTimer);
    props.onInputCapturedChange?.(false);
  });

  function schedulePoll(version: number): void {
    const interval = interactive() ? 80 : 300;
    pollTimer = setTimeout(() => {
      if (version !== pollVersion) return;
      void (async () => {
        const id = oracleSessionId();
        if (!id) return;
        const ts = getTerminalService();
        if (!ts) return;
        const result = await ts.captureOutput(id);
        setCapture(result);
        if (version === pollVersion) schedulePoll(version);
      })();
    }, interval);
  }

  async function spawnOracleSession(): Promise<void> {
    setLoading(true);
    setStatusMsg('');
    try {
      const createSession = getCreateOracleSession();
      if (!createSession) throw new Error('createOracleSession not available');
      const { sessionId } = await createSession();
      setOracleSessionId(sessionId);
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function enterInteractive(): void {
    setInteractive(true);
    props.onInputCapturedChange?.(true);
  }

  function exitInteractive(): void {
    setInteractive(false);
    setInputBuffer('');
    props.onInputCapturedChange?.(false);
  }

  useKeyboard((key) => {
    // Interactive mode: forward all input to tmux session
    if (interactive()) {
      if (key.ctrl && key.name === '\\') {
        exitInteractive();
        return;
      }
      const id = oracleSessionId();
      const ts = getTerminalService();
      if (id && ts) {
        void ts.sendInput(id, key.sequence ?? key.name ?? '');
      }
      return;
    }

    // Non-interactive shortcuts
    if (key.name === 'i' && oracleSessionId()) {
      enterInteractive();
      return;
    }

    if (key.name === 'n' && !oracleSessionId() && oracleReady()) {
      void spawnOracleSession();
      return;
    }

    if (key.name === 'r') {
      void recheckDeps();
      return;
    }

    if (key.name === 'K' && oracleSessionId()) {
      const id = oracleSessionId();
      const ts = getTerminalService();
      if (id && ts) {
        void ts.destroySession(id).then(() => {
          setOracleSessionId(null);
          setCapture(null);
        });
      }
      return;
    }
  });

  const gradColor = lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5);
  const innerWidth = () => Math.max(dimensions().width - 4, 10);

  return (
    <box flexDirection="column" flexGrow={1} width="100%">

      {/* Setup screen — shown when Oracle is not configured */}
      <Show when={depStatus() !== null && !oracleReady()}>
        <OracleSetupScreen
          slackStatus={slackStatus()!}
          onRecheck={recheckDeps}
          onTokensSubmit={async (xoxc, xoxd, teamId, teamName) => {
            const configService = getConfigService();
            configService?.updateOracleConfig({
              slack: { xoxcToken: xoxc, xoxdCookie: xoxd, teamId, teamName },
            });
            await recheckDeps();
          }}
        />
      </Show>

      {/* Loading state while checking deps */}
      <Show when={depStatus() === null}>
        <box paddingX={2} paddingY={1}>
          <text fg={FG_DIM}>{'Checking Oracle configuration...'}</text>
        </box>
      </Show>

      {/* Main Oracle view — shown when ready */}
      <Show when={oracleReady()}>
        <box flexDirection="column" flexGrow={1} width="100%" borderStyle="single" borderColor={gradColor}>

          {/* Header */}
          <box height={1} width="100%" paddingX={1} flexDirection="row">
            <text fg={ORACLE_GRAD[0]}>{LEFT_CAP}</text>
            <text fg="#ffffff" bg={lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5)} attributes={1}>
              {interactive() ? ' ORACLE — INTERACTIVE ' : ' ORACLE '}
            </text>
            <text fg={ORACLE_GRAD[1]}>{RIGHT_CAP}</text>
          </box>

          {/* No session yet */}
          <Show when={!oracleSessionId()}>
            <box paddingX={2} paddingY={1} flexDirection="column">
              <text fg={FG_NORMAL}>{'No Oracle session running.'}</text>
              <box height={1} />
              <Show when={loading()}>
                <text fg={FG_MUTED}>{'Starting session...'}</text>
              </Show>
              <Show when={!loading()}>
                <box flexDirection="row">
                  <text fg={ACCENT_PRIMARY} attributes={1}>{'[N]'}</text>
                  <text fg={FG_DIM}>{' Start Oracle session'}</text>
                </box>
              </Show>
              <Show when={statusMsg()}>
                <box height={1} />
                <text fg={COLOR_ERROR}>{statusMsg()}</text>
              </Show>
            </box>
          </Show>

          {/* Active session terminal output */}
          <Show when={oracleSessionId() && capture()}>
            <box flexGrow={1} width="100%">
              <TerminalOutput
                content={capture()!.content}
                cursor={interactive() ? capture()!.cursor : undefined}
                width={innerWidth()}
              />
            </box>
            <box height={1} paddingX={1}>
              <text fg={FG_DIM}>
                {interactive()
                  ? 'Ctrl+\\ exit interactive | keys forwarded to Oracle'
                  : '[i] interactive | [K] kill session | [r] recheck'}
              </text>
            </box>
          </Show>

        </box>
      </Show>

    </box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/tui/views/oracle-view.tsx
git commit -m "feat(oracle): add OracleView TUI tab with setup gating and Claude session"
```

---

## Phase 6 — Wire Oracle into the App

### Task 16: Add Oracle Tab to app.tsx

**Files:**
- Modify: `src/modules/tui/app.tsx`

- [ ] **Step 1: Read current app.tsx**

```bash
cat src/modules/tui/app.tsx
```

- [ ] **Step 2: Add Oracle tab**

Make these changes to `src/modules/tui/app.tsx`:

**Add import at top:**
```typescript
import { OracleView } from './views/oracle-view';
```

**Update TABS array:**
```typescript
const TABS = [
  { name: 'Tasks' },
  { name: 'Reviews' },
  { name: 'Calendar' },
  { name: 'Oracle' },   // ← add this
];
```

**Add key binding for tab 4** (inside `useKeyboard`, after the `'3'` handler):
```typescript
if (key.name === '4') {
  setActiveTab(3);
  return;
}
```

**Update tab cycling** — the `% TABS.length` already handles 4 tabs automatically since `TABS.length` is now 4. No change needed there.

**Add Match block** (after the Calendar Match):
```typescript
<Match when={activeTab() === 3}>
  <OracleView
    refreshTrigger={refreshTrigger}
    onInputCapturedChange={(captured) => setInputCaptured(captured)}
  />
</Match>
```

- [ ] **Step 3: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/tui/app.tsx
git commit -m "feat(oracle): add Oracle tab to app.tsx (tab 4, key [4])"
```

---

### Task 17: Update StatusBar for Oracle Tab

**Files:**
- Modify: `src/modules/tui/components/status-bar.tsx`

- [ ] **Step 1: Add Oracle hint to TAB_HINTS**

In `src/modules/tui/components/status-bar.tsx`, find `TAB_HINTS` and add the Oracle entry:

```typescript
const TAB_HINTS = [
  '1-4 switch tab | j/k navigate | n new | enter detail | m/M move | x archive | / filter | q quit',
  '1-4 switch tab | h/l panes | j/k navigate | a add repo | x remove | n new agent | i interactive | K kill | r refresh | q quit',
  '1-4 switch tab | h/l day | j/k events | [ / ] week | t today | enter convert | r refresh | q quit',
  '1-4 switch tab | n start session | i interactive | K kill | r recheck | T tokens | q quit',  // ← Oracle
];
```

Also update the existing hints to say `1-4` instead of `1-3`.

- [ ] **Step 2: Verify build**

```bash
bun run build 2>&1 | head -20
```

- [ ] **Step 3: Run full test suite**

```bash
bun run test 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 4: Run linter and formatter**

```bash
bun run lint && bun run format
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/tui/components/status-bar.tsx
git commit -m "feat(oracle): update StatusBar hints for Oracle tab"
```

---

## Phase 7 — Manual Verification

The Oracle feature involves external processes (Slack API, Python, tmux) that cannot be fully unit-tested. These steps verify the end-to-end flow.

### Task 18: End-to-End Verification

- [ ] **Step 1: Build the project**

```bash
bun run build
```

Expected: No errors.

- [ ] **Step 2: Launch tawtui and navigate to Oracle tab**

```bash
./dist/main
```

Press `4`. Expected: Oracle setup screen appears with all three steps showing ✗.

- [ ] **Step 3: Verify token input flow**

Press `T`. Expected: Token input form appears with 4 fields. Tab through them, type test values, press Escape to cancel.

- [ ] **Step 4: Install slacktokens and extract real tokens**

In a separate terminal:
```bash
pip install slacktokens
python3 -m slacktokens
```

Copy the xoxc and xoxd values printed. Enter them in the Oracle tab via `[T]`.

- [ ] **Step 5: Re-check and verify tokens step shows ✓**

Press `R`. Expected: Step 1 shows ✓.

- [ ] **Step 6: Install mempalace**

```bash
pip install mempalace
```

Back in tawtui Oracle tab, press `R`. Expected: Step 2 shows ✓.

- [ ] **Step 7: Start the daemon in a separate terminal**

```bash
tawtui daemon
```

Expected output:
```
Oracle daemon started. Poll interval: 300s
PID 12345 written to ~/.local/share/tawtui/daemon.pid
Starting Slack ingestion...
Ingestion complete: N new messages stored
```

- [ ] **Step 8: Re-check in Oracle tab**

Press `R`. Expected: All 3 steps show ✓, then Oracle tab transitions to the session view.

- [ ] **Step 9: Start an Oracle session**

Press `N`. Expected: Claude Code session spawns in a tmux pane, Oracle tab shows the running session output.

- [ ] **Step 10: Verify tasks appear in Tasks tab**

Wait for Claude to complete a loop. Navigate to Tasks tab (press `1`). Expected: New tasks tagged `+oracle +slack` appear in the task board.

- [ ] **Step 11: Test daemon restart detection**

Kill the daemon (Ctrl+C in daemon terminal). In Oracle tab, press `R`. Expected: Step 3 shows ✗ and setup screen re-appears.

- [ ] **Step 12: Final commit**

```bash
git add -A
git commit -m "feat(oracle): complete Oracle feature — Slack ingestion + mempalace + TUI tab"
```

---

## Reference: Key File Locations

| Purpose | Path |
|---------|------|
| User config | `~/.config/tawtui/config.json` |
| Oracle state (last_checked, cursors) | `~/.config/tawtui/oracle-state.json` |
| Daemon PID | `~/.local/share/tawtui/daemon.pid` |
| tmux sessions | `~/.config/tawtui/sessions.json` |
| mempalace storage (default) | `~/.local/share/mempalace/` |

## Reference: Key Commands

| Command | Purpose |
|---------|---------|
| `tawtui` | Launch the TUI (Oracle tab is tab 4) |
| `tawtui daemon` | Start background Slack polling daemon |
| `python3 -m slacktokens` | Extract xoxc + xoxd from Slack desktop app |
| `pip install mempalace` | Install the memory store |
| `pip install slacktokens` | Install the token extractor |
| `task list +oracle` | View all Oracle-created tasks |
| `task list +oracle +slack` | View Oracle tasks from Slack |
| `bun run test` | Run full test suite |
| `bun run build` | Build the project |
| `bun run lint` | Lint the project |
| `bun run format` | Format the project |

## Reference: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        tawtui (TUI)                         │
│  Tasks │ Reviews │ Calendar │ Oracle                         │
│                             ↓                               │
│                    OracleView                               │
│                    ├── OracleSetupScreen (if not ready)     │
│                    └── Claude tmux session (if ready)        │
│                         ↕ poll 300ms                        │
│                    TerminalService (tmux)                   │
└─────────────────────────────────────────────────────────────┘
                              ↑ MCP
┌────────────────────────┐    │    ┌─────────────────────────┐
│   tawtui daemon        │    │    │   mempalace MCP server  │
│   SlackIngestionService│───▶│───▶│   (local, port auto)    │
│   @Cron every 5min     │ store   └─────────────────────────┘
│         │              │
│   SlackService         │    ┌─────────────────────────────┐
│   (xoxc+xoxd fetch)   │───▶│   Slack Web API             │
│         │              │    │   conversations.list/history │
│   MempalaceService     │    └─────────────────────────────┘
│   (python3 subprocess) │
└────────────────────────┘
         ↑
┌────────────────────────┐
│   Slack desktop app    │
│   xoxc + xoxd tokens  │
│   (via slacktokens)   │
└────────────────────────┘
```
