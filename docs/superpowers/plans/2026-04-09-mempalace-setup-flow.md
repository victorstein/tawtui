# Mempalace Setup Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3rd setup step that initializes the mempalace palace, mines existing Slack data, and installs the Claude Code plugin — all automatically when steps 1+2 are complete.

**Architecture:** Fix MempalaceService to use the standalone `mempalace` CLI (not `python3 -m mempalace`), add init/mine/plugin methods, expose them through the bridge, and wire a new Step 3 in the setup screen that auto-triggers the initialization flow with substep progress. Change Oracle session cwd to a project-scoped workspace directory so the plugin only activates for Oracle sessions.

**Tech Stack:** TypeScript, NestJS (DI), SolidJS (TUI), Bun runtime, mempalace CLI, Claude Code CLI

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/modules/slack/mempalace.service.ts` | Wraps mempalace CLI — fix invocation, add init/mine/plugin/isInitialized |
| `src/modules/dependency.types.ts` | Add `oracleInitialized` to `DependencyStatus` |
| `src/modules/dependency.service.ts` | Check palace initialization, update `oracleReady` |
| `src/modules/tui/bridge.ts` | Add `initializeOracle` method + progress callback type |
| `src/modules/tui.service.ts` | Inject MempalaceService, wire `initializeOracle` |
| `src/modules/tui/components/oracle-setup-screen.tsx` | Step 3 UI with auto-trigger and substep progress |
| `src/modules/tui/views/oracle-view.tsx` | Wire `onInitializeOracle` handler |
| `src/modules/terminal.service.ts` | Change Oracle session cwd to workspace dir |
| `test/mempalace.service.spec.ts` | Tests for new + fixed methods |
| `test/dependency.service.spec.ts` | Tests for `oracleInitialized` |

---

### Task 1: Fix MempalaceService CLI and add path constants + isInitialized

**Files:**
- Modify: `src/modules/slack/mempalace.service.ts`
- Modify: `test/mempalace.service.spec.ts`

- [ ] **Step 1: Update tests for CLI fix and add isInitialized tests**

In `test/mempalace.service.spec.ts`, update the existing `isInstalled` test that checks args, and add new tests for `isInitialized`:

```typescript
// Update the existing test at line 36-40:
it('isInstalled calls mempalace status with correct args', () => {
  service.isInstalled();
  expect(mockSpawnSync).toHaveBeenCalledWith(
    ['mempalace', 'status'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
});

// Update the existing test at line 55-68:
it('mine calls Bun.spawn with correct args', async () => {
  const mockProc = {
    exited: Promise.resolve(0),
    stderr: new ReadableStream(),
  };
  mockSpawn.mockReturnValueOnce(mockProc);

  await service.mine('/some/dir', 'test-wing');

  expect(mockSpawn).toHaveBeenCalledWith(
    [
      'mempalace',
      'mine',
      '/some/dir',
      '--mode',
      'convos',
      '--wing',
      'test-wing',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
});

// Add these new tests after the existing mine tests (after line 95):
describe('isInitialized', () => {
  let existsSyncMock: jest.SpyInstance;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    existsSyncMock = jest.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncMock.mockRestore();
  });

  it('returns true when palace.db exists at palace path', () => {
    existsSyncMock.mockReturnValue(true);
    expect(service.isInitialized()).toBe(true);
  });

  it('returns false when palace.db does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    expect(service.isInitialized()).toBe(false);
  });

  it('checks the correct path under ~/.local/share/tawtui/mempalace/', () => {
    existsSyncMock.mockReturnValue(false);
    service.isInitialized();
    const calledPath = existsSyncMock.mock.calls[0][0] as string;
    expect(calledPath).toMatch(/\.local\/share\/tawtui\/mempalace\/palace\.db$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: The `isInstalled calls mempalace status with correct args` test FAILS (still expects `python3 -m mempalace`). The `mine calls Bun.spawn with correct args` test FAILS. The `isInitialized` tests FAIL (method doesn't exist).

- [ ] **Step 3: Fix CLI invocation and add isInitialized**

Replace the entire contents of `src/modules/slack/mempalace.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

/** Base directory for all tawtui data files. */
export const TAWTUI_DATA_DIR = join(homedir(), '.local', 'share', 'tawtui');

/** Path to the mempalace palace database. */
export const PALACE_PATH = join(TAWTUI_DATA_DIR, 'mempalace');

/** Staging directory for raw Slack message JSON files. */
export const STAGING_DIR = join(TAWTUI_DATA_DIR, 'slack-inbox');

/** Working directory for Oracle Claude Code sessions (project-scoped plugin). */
export const ORACLE_WORKSPACE_DIR = join(TAWTUI_DATA_DIR, 'oracle-workspace');

@Injectable()
export class MempalaceService {
  private readonly logger = new Logger(MempalaceService.name);

  /** Check if mempalace CLI is installed by running `mempalace status`. */
  isInstalled(): boolean {
    const result = Bun.spawnSync(['mempalace', 'status'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  }

  /** Check if the palace has been initialized (palace.db exists). */
  isInitialized(): boolean {
    return existsSync(join(PALACE_PATH, 'palace.db'));
  }

  /**
   * Mine a directory of conversation files into mempalace.
   * Uses `mempalace mine <dir> --mode convos --wing <wing>`.
   *
   * Mining is idempotent — already-processed files are skipped automatically
   * (mempalace deduplicates by source file path).
   *
   * Uses async Bun.spawn() to avoid blocking the TUI event loop.
   */
  async mine(dir: string, wing: string): Promise<void> {
    const proc = Bun.spawn(
      ['mempalace', 'mine', dir, '--mode', 'convos', '--wing', wing],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`mempalace mine failed (exit ${exitCode}): ${stderr}`);
    }

    this.logger.log(`Mined ${dir} into wing "${wing}"`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/mempalace.service.ts test/mempalace.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(mempalace): use standalone CLI and add isInitialized check

Replace python3 -m mempalace with direct mempalace CLI invocation
(pipx installs standalone binaries). Add path constants for palace,
staging, and workspace directories. Add isInitialized() that checks
for palace.db existence.
EOF
)"
```

---

### Task 2: Add init() method to MempalaceService

**Files:**
- Modify: `src/modules/slack/mempalace.service.ts`
- Modify: `test/mempalace.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/mempalace.service.spec.ts`, inside the main `describe` block after the `isInitialized` tests:

```typescript
describe('init', () => {
  it('runs mempalace init with the palace path', async () => {
    const mockProc = {
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    };
    mockSpawn.mockReturnValueOnce(mockProc);

    await service.init('/tmp/test-palace');

    expect(mockSpawn).toHaveBeenCalledWith(
      ['mempalace', 'init', '/tmp/test-palace'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
  });

  it('throws when mempalace init fails', async () => {
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('init failed'));
        controller.close();
      },
    });
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(1),
      stdout: new ReadableStream(),
      stderr: errorStream,
    });

    await expect(service.init('/tmp/test-palace')).rejects.toThrow(
      /mempalace init failed/,
    );
  });

  it('resolves when mempalace init succeeds', async () => {
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });

    await expect(service.init('/tmp/test-palace')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: FAIL — `service.init is not a function`

- [ ] **Step 3: Implement init()**

Add this method to `MempalaceService` in `src/modules/slack/mempalace.service.ts`, after `isInitialized()`:

```typescript
  /** Initialize a new mempalace palace at the given path. */
  async init(palacePath: string): Promise<void> {
    const proc = Bun.spawn(['mempalace', 'init', palacePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `mempalace init failed (exit ${exitCode}): ${stderr}`,
      );
    }

    this.logger.log(`Initialized palace at ${palacePath}`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/mempalace.service.ts test/mempalace.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(mempalace): add init() method for palace initialization
EOF
)"
```

---

### Task 3: Add mineIfNeeded() method to MempalaceService

**Files:**
- Modify: `src/modules/slack/mempalace.service.ts`
- Modify: `test/mempalace.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/mempalace.service.spec.ts`, inside the main `describe` block after the `init` tests:

```typescript
describe('mineIfNeeded', () => {
  let existsSyncMock: jest.SpyInstance;
  let readdirSyncMock: jest.SpyInstance;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    existsSyncMock = jest.spyOn(fs, 'existsSync');
    readdirSyncMock = jest.spyOn(fs, 'readdirSync');
  });

  afterEach(() => {
    existsSyncMock.mockRestore();
    readdirSyncMock.mockRestore();
  });

  it('returns { mined: false } when staging dir does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    const result = await service.mineIfNeeded('/tmp/staging', 'slack');
    expect(result).toEqual({ mined: false });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns { mined: false } when staging dir has no .json files', async () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['readme.txt', 'data.csv']);
    const result = await service.mineIfNeeded('/tmp/staging', 'slack');
    expect(result).toEqual({ mined: false });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('mines and returns { mined: true } when .json files exist', async () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['channel1.json', 'channel2.json']);
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stderr: new ReadableStream(),
    });

    const result = await service.mineIfNeeded('/tmp/staging', 'slack');

    expect(result).toEqual({ mined: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      ['mempalace', 'mine', '/tmp/staging', '--mode', 'convos', '--wing', 'slack'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: FAIL — `service.mineIfNeeded is not a function`

- [ ] **Step 3: Implement mineIfNeeded()**

Add this import at the top of `src/modules/slack/mempalace.service.ts` (update the existing `fs` import):

```typescript
import { existsSync, readdirSync } from 'fs';
```

Add this method to `MempalaceService`, after `init()`:

```typescript
  /**
   * Mine existing data from the staging directory if any .json files exist.
   * Returns whether mining actually ran.
   */
  async mineIfNeeded(
    stagingDir: string,
    wing: string,
  ): Promise<{ mined: boolean }> {
    if (!existsSync(stagingDir)) return { mined: false };

    const files = readdirSync(stagingDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return { mined: false };

    await this.mine(stagingDir, wing);
    return { mined: true };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/mempalace.service.ts test/mempalace.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(mempalace): add mineIfNeeded() for staging dir ingestion
EOF
)"
```

---

### Task 4: Add installPlugin() method to MempalaceService

**Files:**
- Modify: `src/modules/slack/mempalace.service.ts`
- Modify: `test/mempalace.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/mempalace.service.spec.ts`, inside the main `describe` block after the `mineIfNeeded` tests:

```typescript
describe('installPlugin', () => {
  let mkdirSyncMock: jest.SpyInstance;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    mkdirSyncMock = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
  });

  afterEach(() => {
    mkdirSyncMock.mockRestore();
  });

  it('creates the workspace directory', async () => {
    // Two spawn calls: marketplace add + plugin install
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });

    await service.installPlugin('/tmp/workspace');

    expect(mkdirSyncMock).toHaveBeenCalledWith('/tmp/workspace', {
      recursive: true,
    });
  });

  it('runs claude plugin marketplace add then install with project scope', async () => {
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });

    await service.installPlugin('/tmp/workspace');

    expect(mockSpawn).toHaveBeenCalledWith(
      ['claude', 'plugin', 'marketplace', 'add', 'milla-jovovich/mempalace'],
      expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      ['claude', 'plugin', 'install', '--scope', 'project', 'mempalace'],
      expect.objectContaining({
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: '/tmp/workspace',
      }),
    );
  });

  it('throws when plugin install fails', async () => {
    // marketplace add succeeds
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });
    // plugin install fails
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('install error'));
        controller.close();
      },
    });
    mockSpawn.mockReturnValueOnce({
      exited: Promise.resolve(1),
      stdout: new ReadableStream(),
      stderr: errorStream,
    });

    await expect(service.installPlugin('/tmp/workspace')).rejects.toThrow(
      /plugin install failed/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: FAIL — `service.installPlugin is not a function`

- [ ] **Step 3: Implement installPlugin()**

Add `mkdirSync` to the `fs` import at the top of `src/modules/slack/mempalace.service.ts`:

```typescript
import { existsSync, readdirSync, mkdirSync } from 'fs';
```

Add this method to `MempalaceService`, after `mineIfNeeded()`:

```typescript
  /**
   * Install the mempalace Claude Code plugin at project scope in the given
   * workspace directory. Creates the directory if it doesn't exist.
   */
  async installPlugin(workspaceDir: string): Promise<void> {
    mkdirSync(workspaceDir, { recursive: true });

    // Step 1: Add plugin from marketplace (idempotent if already added)
    const addProc = Bun.spawn(
      ['claude', 'plugin', 'marketplace', 'add', 'milla-jovovich/mempalace'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    await addProc.exited;
    // Ignore exit code — marketplace add may warn if already added

    // Step 2: Install at project scope in workspace directory
    const installProc = Bun.spawn(
      ['claude', 'plugin', 'install', '--scope', 'project', 'mempalace'],
      { stdout: 'pipe', stderr: 'pipe', cwd: workspaceDir },
    );

    const exitCode = await installProc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(installProc.stderr).text();
      throw new Error(
        `plugin install failed (exit ${exitCode}): ${stderr}`,
      );
    }

    this.logger.log(`Installed mempalace plugin in ${workspaceDir}`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/mempalace.service.spec.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/slack/mempalace.service.ts test/mempalace.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(mempalace): add installPlugin() for project-scoped Claude Code plugin
EOF
)"
```

---

### Task 5: Update DependencyTypes and DependencyService for oracleInitialized

**Files:**
- Modify: `src/modules/dependency.types.ts`
- Modify: `src/modules/dependency.service.ts`
- Modify: `test/dependency.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/dependency.service.spec.ts`, inside the main `describe` block after the existing tests (after line 106):

```typescript
it('oracleReady requires oracleInitialized', async () => {
  // Set up: tokens present, mempalace installed, but palace not initialized
  (mockConfigService.getOracleConfig as jest.Mock).mockReturnValue({
    pollIntervalSeconds: 300,
    slack: {
      xoxcToken: 'xoxc-xxx',
      xoxdCookie: 'xoxd-xxx',
      teamId: 'T123',
      teamName: 'Test',
    },
  });
  // mempalace CLI available
  mockBun.spawnSync.mockImplementation((args: string[]) => {
    if (args[0] === 'which' && args[1] === 'mempalace') return { exitCode: 0 };
    if (args[0] === 'which') return { exitCode: 1 };
    if (args[0] === 'test') return { exitCode: 1 };
    return { exitCode: 1 };
  });

  const status = await service.checkAll();

  // oracleReady should be false because palace is not initialized
  // (existsSync returns false by default in test environment)
  expect(status.oracleReady).toBe(false);
});

it('status includes oracleInitialized field', async () => {
  const status = await service.checkAll();
  expect(status).toHaveProperty('oracleInitialized');
  expect(typeof status.oracleInitialized).toBe('boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/dependency.service.spec.ts`
Expected: FAIL — `oracleInitialized` not in status, `oracleReady` still uses old condition.

- [ ] **Step 3: Update DependencyStatus type**

In `src/modules/dependency.types.ts`, add `oracleInitialized` to `DependencyStatus` and update the comment on `oracleReady`:

```typescript
export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  slack: SlackDepStatus;
  oracleInitialized: boolean;
  oracleReady: boolean; // hasTokens && mempalaceInstalled && oracleInitialized
}
```

- [ ] **Step 4: Update DependencyService.checkAll()**

In `src/modules/dependency.service.ts`, add imports at the top:

```typescript
import { join } from 'path';
import { existsSync } from 'fs';
import { PALACE_PATH } from './slack/mempalace.service';
```

Then update `checkAll()` to compute and return `oracleInitialized`. Replace the return block (lines 40-64) with:

```typescript
    const oracleInitialized = existsSync(join(PALACE_PATH, 'palace.db'));

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
      platform,
      allGood: ghInstalled && ghAuthenticated && taskInstalled,
      calendarReady: gogInstalled && gogAuthenticated && gogHasCredentials,
      slack: slackStatus,
      oracleInitialized,
      oracleReady:
        slackStatus.hasTokens &&
        slackStatus.mempalaceInstalled &&
        oracleInitialized,
    };
```

- [ ] **Step 5: Update the existing oracleReady test**

The existing test `oracleReady depends on hasTokens and mempalaceInstalled` (line 57) will break because `oracleReady` now also requires `oracleInitialized`. Update it in `test/dependency.service.spec.ts`:

```typescript
it('oracleReady depends on hasTokens, mempalaceInstalled, and oracleInitialized', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

  (mockConfigService.getOracleConfig as jest.Mock).mockReturnValue({
    pollIntervalSeconds: 300,
    slack: {
      xoxcToken: 'xoxc-xxx',
      xoxdCookie: 'xoxd-xxx',
      teamId: 'T123',
      teamName: 'Test',
    },
  });
  // mempalace CLI available
  mockBun.spawnSync.mockImplementation((args: string[]) => {
    if (args[0] === 'which' && args[1] === 'mempalace') return { exitCode: 0 };
    if (args[0] === 'which') return { exitCode: 1 };
    if (args[0] === 'test') return { exitCode: 1 };
    return { exitCode: 1 };
  });

  const status = await service.checkAll();
  expect(status.oracleReady).toBe(true);

  existsSyncSpy.mockRestore();
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- test/dependency.service.spec.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dependency.types.ts src/modules/dependency.service.ts test/dependency.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(deps): add oracleInitialized check to dependency status

oracleReady now requires hasTokens && mempalaceInstalled &&
oracleInitialized (palace.db exists).
EOF
)"
```

---

### Task 6: Bridge and TuiService wiring for initializeOracle

**Files:**
- Modify: `src/modules/tui/bridge.ts`
- Modify: `src/modules/tui.service.ts`

- [ ] **Step 1: Add initializeOracle to bridge interface**

In `src/modules/tui/bridge.ts`, add the progress callback type and update the bridge interface.

Add this type before the `TawtuiBridge` interface:

```typescript
export interface OracleInitProgress {
  message: string;
  status: 'running' | 'done' | 'skip';
}
```

Add this to the `TawtuiBridge` interface (after the `extractSlackTokens` line):

```typescript
  initializeOracle: (
    onProgress: (progress: OracleInitProgress) => void,
  ) => Promise<void>;
```

Add this getter function at the end (before `getTuiExit`):

```typescript
export function getInitializeOracle():
  | TawtuiBridge['initializeOracle']
  | null {
  return getBridge()?.initializeOracle ?? null;
}
```

- [ ] **Step 2: Wire initializeOracle in TuiService**

In `src/modules/tui.service.ts`, add the MempalaceService import:

```typescript
import { MempalaceService, PALACE_PATH, STAGING_DIR, ORACLE_WORKSPACE_DIR } from './slack/mempalace.service';
```

Add `MempalaceService` to the constructor (after `tokenExtractorService`):

```typescript
    private readonly mempalaceService: MempalaceService,
```

Also add it to the `TawtuiGlobal.__tawtui` interface inside the file. Add after `extractSlackTokens`:

```typescript
    initializeOracle: (
      onProgress: (progress: { message: string; status: 'running' | 'done' | 'skip' }) => void,
    ) => Promise<void>;
```

Add the implementation in the `g.__tawtui = { ... }` object (after the `extractSlackTokens` line):

```typescript
      initializeOracle: async (onProgress) => {
        // Step 1: Initialize palace
        onProgress({ message: 'Initializing palace...', status: 'running' });
        await this.mempalaceService.init(PALACE_PATH);
        onProgress({ message: 'Palace initialized', status: 'done' });

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

        // Step 3: Install Claude Code plugin
        onProgress({
          message: 'Installing Claude Code plugin...',
          status: 'running',
        });
        await this.mempalaceService.installPlugin(ORACLE_WORKSPACE_DIR);
        onProgress({ message: 'Plugin installed', status: 'done' });
      },
```

- [ ] **Step 3: Run the full test suite to verify nothing is broken**

Run: `bun run test`
Expected: All tests PASS. (TuiService is not unit-tested, but no compile errors.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/tui/bridge.ts src/modules/tui.service.ts
git commit -m "$(cat <<'EOF'
feat(bridge): wire initializeOracle with progress callback

Exposes palace init, data mining, and plugin install as a single
sequenced bridge method with step-by-step progress reporting.
EOF
)"
```

---

### Task 7: Oracle Setup Screen Step 3 with progress and auto-trigger

**Files:**
- Modify: `src/modules/tui/components/oracle-setup-screen.tsx`

- [ ] **Step 1: Add oracleInitialized prop and onInitializeOracle callback**

In `src/modules/tui/components/oracle-setup-screen.tsx`, update the `OracleSetupScreenProps` interface (at line 27):

```typescript
interface OracleSetupScreenProps {
  slackStatus: SlackDepStatus;
  oracleInitialized: boolean;
  onRecheck: () => Promise<void>;
  onTokensSubmit: (
    xoxc: string,
    xoxd: string,
    teamId: string,
    teamName: string,
  ) => Promise<void>;
  onInstallDeps: () => Promise<{ success: boolean; error?: string }>;
  onAutoDetect: () => Promise<ExtractionResult>;
  onInitializeOracle: (
    onProgress: (progress: { message: string; status: 'running' | 'done' | 'skip' }) => void,
  ) => Promise<void>;
}
```

- [ ] **Step 2: Add initialization signals and auto-trigger effect**

Add these signals after the existing signal declarations (after line 69):

```typescript
  const [initializing, setInitializing] = createSignal(false);
  const [initMessages, setInitMessages] = createSignal<
    Array<{ message: string; status: 'running' | 'done' | 'skip' }>
  >([]);
  const [initError, setInitError] = createSignal<string | null>(null);
```

Add the auto-trigger effect. Place it after the `hasInstallablePackages` helper (after line 72 in the original, after the new signals):

```typescript
  // Auto-trigger initialization when steps 1+2 are complete
  let initTriggered = false;
  createEffect(() => {
    if (
      props.slackStatus.hasTokens &&
      props.slackStatus.mempalaceInstalled &&
      !props.oracleInitialized &&
      !initTriggered &&
      !initializing() &&
      !initError()
    ) {
      initTriggered = true;
      setInitializing(true);
      setInitMessages([]);
      setInitError(null);
      void props
        .onInitializeOracle((progress) => {
          setInitMessages((prev) => {
            // Replace last 'running' entry if same phase, otherwise append
            const updated = prev.filter((p) => p.status !== 'running');
            return [...updated, progress];
          });
        })
        .then(() => {
          setInitializing(false);
          void props.onRecheck();
        })
        .catch((err: unknown) => {
          setInitializing(false);
          setInitError(
            err instanceof Error ? err.message : String(err),
          );
          initTriggered = false; // allow retry
        });
    }
  });
```

Add `createEffect` to the solid-js import at line 1:

```typescript
import { createSignal, createEffect, Show, For } from 'solid-js';
```

- [ ] **Step 3: Add Step 3 UI section**

Add the Step 3 section in the JSX, after the Step 2 section (after the `</Show>` that closes the `!props.slackStatus.mempalaceInstalled` block, around line 437). Place it before the `<box height={1} />` that precedes the key hints:

```tsx
      <box height={1} />

      {/* Step 3: Initialize Oracle */}
      <box flexDirection="row">
        <text fg={FG_NORMAL} attributes={1}>
          {'  Step 3: '}
        </text>
        <text fg={FG_NORMAL} attributes={1}>
          Initialize Oracle
        </text>
        <text>{'  '}</text>
        <text
          fg={
            props.oracleInitialized
              ? COLOR_SUCCESS
              : props.slackStatus.hasTokens && props.slackStatus.mempalaceInstalled
                ? COLOR_WARNING
                : FG_MUTED
          }
        >
          {props.oracleInitialized ? '✓' : '✗'}
        </text>
      </box>

      {/* Initialization progress */}
      <Show when={initializing() || initMessages().length > 0}>
        <For each={initMessages()}>
          {(msg) => (
            <box flexDirection="row">
              <text>{'    '}</text>
              <text
                fg={
                  msg.status === 'done'
                    ? COLOR_SUCCESS
                    : msg.status === 'skip'
                      ? FG_DIM
                      : ORACLE_GRAD[0]
                }
              >
                {msg.status === 'done'
                  ? '✓ '
                  : msg.status === 'skip'
                    ? '– '
                    : '⟳ '}
              </text>
              <text
                fg={
                  msg.status === 'done'
                    ? FG_NORMAL
                    : msg.status === 'skip'
                      ? FG_DIM
                      : FG_NORMAL
                }
              >
                {msg.message}
              </text>
            </box>
          )}
        </For>
      </Show>

      {/* Init error */}
      <Show when={initError()}>
        <box flexDirection="row">
          <text fg={COLOR_ERROR}>{'    ✗ '}</text>
          <text fg={COLOR_ERROR}>{initError()}</text>
        </box>
      </Show>
```

- [ ] **Step 4: Add COLOR_WARNING to the theme import if not already imported**

Check the import at line 19-21. If `COLOR_WARNING` is already imported, skip this step. If not, add it:

```typescript
import {
  P,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  BG_INPUT,
  BG_INPUT_FOCUS,
  ACCENT_PRIMARY,
  COLOR_SUCCESS,
  COLOR_ERROR,
  COLOR_WARNING,
  SEPARATOR_COLOR,
} from '../theme';
```

(Looking at line 19-21, `COLOR_WARNING` is already imported. No change needed.)

- [ ] **Step 5: Run the build to verify no compile errors**

Run: `bun run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tui/components/oracle-setup-screen.tsx
git commit -m "$(cat <<'EOF'
feat(tui): add Step 3 Initialize Oracle with auto-trigger and progress

Auto-triggers palace init, data mining, and plugin install when
steps 1+2 are complete. Shows per-substep progress with status icons.
EOF
)"
```

---

### Task 8: Wire OracleView and change Oracle session cwd

**Files:**
- Modify: `src/modules/tui/views/oracle-view.tsx`
- Modify: `src/modules/terminal.service.ts`

- [ ] **Step 1: Add initializeOracle handler to OracleView**

In `src/modules/tui/views/oracle-view.tsx`, add the bridge import for `getInitializeOracle`:

```typescript
import {
  getDependencyService,
  getTerminalService,
  getConfigService,
  getSlackIngestionService,
  getCreateOracleSession,
  getExtractSlackTokens,
  getInitializeOracle,
} from '../bridge';
```

Add the handler function in the `// Setup screen callbacks` section (after `handleAutoDetect`, around line 367):

```typescript
  async function handleInitializeOracle(
    onProgress: (progress: { message: string; status: 'running' | 'done' | 'skip' }) => void,
  ): Promise<void> {
    const initOracle = getInitializeOracle();
    if (!initOracle) {
      throw new Error('Oracle initializer not available');
    }
    await initOracle(onProgress);
  }
```

- [ ] **Step 2: Pass new props to OracleSetupScreen**

Update the `<OracleSetupScreen>` JSX (around line 562) to pass the new props:

```tsx
        <OracleSetupScreen
          slackStatus={depStatus()!.slack}
          oracleInitialized={depStatus()!.oracleInitialized}
          onRecheck={handleRecheck}
          onTokensSubmit={handleTokensSubmit}
          onInstallDeps={handleInstallDeps}
          onAutoDetect={handleAutoDetect}
          onInitializeOracle={handleInitializeOracle}
        />
```

- [ ] **Step 3: Change Oracle session cwd in TerminalService**

In `src/modules/terminal.service.ts`, add the import for `ORACLE_WORKSPACE_DIR`:

```typescript
import { ORACLE_WORKSPACE_DIR } from './slack/mempalace.service';
```

Update the `createOracleSession()` method. Change line 854 from:

```typescript
      cwd: process.env.HOME ?? process.cwd(),
```

to:

```typescript
      cwd: ORACLE_WORKSPACE_DIR,
```

- [ ] **Step 4: Run the build to verify no compile errors**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `bun run test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tui/views/oracle-view.tsx src/modules/terminal.service.ts
git commit -m "$(cat <<'EOF'
feat(oracle): wire initialization flow and use workspace cwd

OracleView passes oracleInitialized and onInitializeOracle to setup
screen. Oracle sessions now launch from the workspace directory so
the project-scoped mempalace plugin is active.
EOF
)"
```
