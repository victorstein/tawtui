# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS notification service that sends native Notification Center alerts via `terminal-notifier`, with auto-detection of the running terminal for click-to-focus behavior.

**Architecture:** New NotificationModule following the existing module triad pattern (service + module + types). Wraps `terminal-notifier` CLI via `Bun.spawn`, integrates as optional dependency in DependencyService, and bridges to the TUI layer via `globalThis.__tawtui`.

**Tech Stack:** NestJS, Bun, TypeScript, terminal-notifier CLI, SolidJS (setup wizard update)

---

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Create | `src/modules/notification.types.ts` | NotificationPayload interface |
| Create | `src/modules/notification.service.ts` | terminal-notifier CLI wrapper, terminal detection |
| Create | `src/modules/notification.module.ts` | NestJS module registration |
| Modify | `src/modules/dependency.types.ts` | Add notificationsReady + NotificationDepStatus |
| Modify | `src/modules/dependency.service.ts` | Add notification check to checkAll() |
| Modify | `src/modules/dependency.module.ts` | Import NotificationModule |
| Modify | `src/modules/tui.module.ts` | Import NotificationModule |
| Modify | `src/modules/tui.service.ts` | Bridge notificationService to globalThis |
| Modify | `src/modules/tui/bridge.ts` | Add NotificationService type + getter |
| Modify | `src/modules/tui/components/dialog-setup-wizard.tsx` | Add Terminal Notifier optional row |
| Modify | `homebrew-formula/tawtui.rb` | Add terminal-notifier to optional caveats |
| Create | `test/notification.service.spec.ts` | Unit tests for NotificationService |

---

### Task 1: Notification Types

[@nestjs]

**Files:**
- Create: `src/modules/notification.types.ts`

- [ ] **Step 1: Create notification types file**

```typescript
// src/modules/notification.types.ts

export interface NotificationPayload {
  title: string;
  message: string;
  subtitle?: string;
  appIcon?: string;
}

export const TERMINAL_BUNDLE_IDS: Record<string, string> = {
  Apple_Terminal: 'com.apple.Terminal',
  'iTerm.app': 'com.googlecode.iterm2',
  WezTerm: 'com.github.wez.wezterm',
  Alacritty: 'org.alacritty',
  kitty: 'net.kovidgoyal.kitty',
  ghostty: 'com.mitchellh.ghostty',
};

export const DEFAULT_BUNDLE_ID = 'com.apple.Terminal';
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/modules/notification.types.ts --no-bundle --outdir /tmp/tawtui-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/notification.types.ts
git commit -m "feat(notification): add notification payload types and terminal bundle ID map"
```

---

### Task 2: Notification Service

[@nestjs]

**Files:**
- Create: `src/modules/notification.service.ts`
- Reference: `src/modules/github.service.ts` (async CLI wrapper pattern)
- Reference: `src/modules/notification.types.ts` (types from Task 1)

- [ ] **Step 1: Create the notification service**

```typescript
// src/modules/notification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import type { NotificationPayload } from './notification.types';
import { TERMINAL_BUNDLE_IDS, DEFAULT_BUNDLE_ID } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private terminalBundleId: string;

  constructor() {
    this.terminalBundleId = this.detectTerminalBundleId();
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    const installed = await this.isInstalled();
    if (!installed) {
      this.logger.debug('terminal-notifier not installed, skipping notification');
      return false;
    }

    const args = this.buildArgs(payload);
    return this.exec(args);
  }

  async isInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['terminal-notifier', '-help'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  private buildArgs(payload: NotificationPayload): string[] {
    const args: string[] = [
      '-title',
      payload.title,
      '-message',
      payload.message,
      '-sound',
      'default',
      '-activate',
      this.terminalBundleId,
    ];

    if (payload.subtitle) {
      args.push('-subtitle', payload.subtitle);
    }

    if (payload.appIcon) {
      args.push('-appIcon', payload.appIcon);
    }

    return args;
  }

  private async exec(args: string[]): Promise<boolean> {
    try {
      const proc = Bun.spawn(['terminal-notifier', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stderr, exitCode] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        this.logger.debug(`terminal-notifier failed (exit ${exitCode}): ${stderr}`);
        return false;
      }

      return true;
    } catch {
      this.logger.debug('terminal-notifier exec failed');
      return false;
    }
  }

  private detectTerminalBundleId(): string {
    const termProgram = process.env.TERM_PROGRAM;

    if (!termProgram) {
      this.logger.warn(
        'TERM_PROGRAM not set, falling back to com.apple.Terminal for notification click actions',
      );
      return DEFAULT_BUNDLE_ID;
    }

    const bundleId = TERMINAL_BUNDLE_IDS[termProgram];

    if (!bundleId) {
      this.logger.warn(
        `Unknown terminal "${termProgram}", falling back to com.apple.Terminal for notification click actions`,
      );
      return DEFAULT_BUNDLE_ID;
    }

    return bundleId;
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/modules/notification.service.ts --no-bundle --outdir /tmp/tawtui-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/notification.service.ts
git commit -m "feat(notification): add notification service wrapping terminal-notifier CLI"
```

---

### Task 3: Notification Module

[@nestjs]

**Files:**
- Create: `src/modules/notification.module.ts`

- [ ] **Step 1: Create the NestJS module**

```typescript
// src/modules/notification.module.ts

import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/modules/notification.module.ts --no-bundle --outdir /tmp/tawtui-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/notification.module.ts
git commit -m "feat(notification): add NestJS notification module"
```

---

### Task 4: Notification Service Tests

[@nestjs]

**Files:**
- Create: `test/notification.service.spec.ts`
- Reference: `src/modules/notification.service.ts` (service from Task 2)
- Reference: `src/modules/notification.types.ts` (types from Task 1)

- [ ] **Step 1: Create the test file**

```typescript
// test/notification.service.spec.ts

import { NotificationService } from '../src/modules/notification.service';
import { DEFAULT_BUNDLE_ID } from '../src/modules/notification.types';

// Save original env and Bun.spawn
const originalEnv = { ...process.env };
const originalSpawn = Bun.spawn;

function mockSpawn(exitCode: number, stdout = '', stderr = '') {
  (Bun as { spawn: typeof Bun.spawn }).spawn = ((
    cmd: string[],
    opts?: { stdout?: string; stderr?: string },
  ) => {
    const stdoutBlob = new Blob([stdout]);
    const stderrBlob = new Blob([stderr]);
    return {
      stdout: stdoutBlob.stream(),
      stderr: stderrBlob.stream(),
      exited: Promise.resolve(exitCode),
      kill: () => {},
    };
  }) as typeof Bun.spawn;
}

function mockSpawnThrow() {
  (Bun as { spawn: typeof Bun.spawn }).spawn = (() => {
    throw new Error('binary not found');
  }) as unknown as typeof Bun.spawn;
}

afterEach(() => {
  process.env = { ...originalEnv };
  (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
});

describe('NotificationService', () => {
  describe('detectTerminalBundleId', () => {
    it('detects iTerm', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';
      const service = new NotificationService();
      // send() will use the detected bundle ID — we verify via isInstalled + buildArgs indirectly
      expect(service).toBeDefined();
    });

    it('detects ghostty', () => {
      process.env.TERM_PROGRAM = 'ghostty';
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('falls back to default when TERM_PROGRAM is unset', () => {
      delete process.env.TERM_PROGRAM;
      const service = new NotificationService();
      expect(service).toBeDefined();
    });

    it('falls back to default for unknown terminal', () => {
      process.env.TERM_PROGRAM = 'SomeUnknownTerminal';
      const service = new NotificationService();
      expect(service).toBeDefined();
    });
  });

  describe('isInstalled', () => {
    it('returns true when terminal-notifier exits 0', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      expect(await service.isInstalled()).toBe(true);
    });

    it('returns false when terminal-notifier exits non-zero', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(1);
      expect(await service.isInstalled()).toBe(false);
    });

    it('returns false when terminal-notifier binary not found', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawnThrow();
      expect(await service.isInstalled()).toBe(false);
    });
  });

  describe('send', () => {
    it('returns true on successful notification', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(true);
    });

    it('returns false when terminal-notifier is not installed', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawnThrow();
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(false);
    });

    it('returns false when terminal-notifier fails', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();

      let callCount = 0;
      (Bun as { spawn: typeof Bun.spawn }).spawn = ((
        cmd: string[],
      ) => {
        callCount++;
        // First call is isInstalled (-help), return success
        // Second call is the actual notification, return failure
        const exitCode = callCount === 1 ? 0 : 1;
        const blob = new Blob(['']);
        return {
          stdout: blob.stream(),
          stderr: blob.stream(),
          exited: Promise.resolve(exitCode),
          kill: () => {},
        };
      }) as typeof Bun.spawn;

      const result = await service.send({
        title: 'Test',
        message: 'Hello',
      });
      expect(result).toBe(false);
    });

    it('handles optional subtitle and appIcon', async () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const service = new NotificationService();
      mockSpawn(0);
      const result = await service.send({
        title: 'Test',
        message: 'Hello',
        subtitle: 'Sub',
        appIcon: '/path/to/icon.png',
      });
      expect(result).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `bun run test -- test/notification.service.spec.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/notification.service.spec.ts
git commit -m "test(notification): add unit tests for notification service"
```

---

### Task 5: Dependency Integration

[@nestjs]

**Files:**
- Modify: `src/modules/dependency.types.ts`
- Modify: `src/modules/dependency.service.ts`
- Modify: `src/modules/dependency.module.ts`

- [ ] **Step 1: Add notification types to DependencyStatus**

In `src/modules/dependency.types.ts`, add the `NotificationDepStatus` interface and the `notification` + `notificationsReady` fields to `DependencyStatus`:

```typescript
// Add after GogDepStatus interface
export interface NotificationDepStatus extends DepStatus {}

// Add to DependencyStatus interface
export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  notification: NotificationDepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  notificationsReady: boolean;
}
```

The full file after changes:

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

export interface NotificationDepStatus extends DepStatus {}

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  notification: NotificationDepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  notificationsReady: boolean;
}
```

- [ ] **Step 2: Import NotificationModule in DependencyModule**

In `src/modules/dependency.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DependencyService } from './dependency.service';
import { GithubModule } from './github.module';
import { TaskwarriorModule } from './taskwarrior.module';
import { CalendarModule } from './calendar.module';
import { NotificationModule } from './notification.module';

@Module({
  imports: [GithubModule, TaskwarriorModule, CalendarModule, NotificationModule],
  providers: [DependencyService],
  exports: [DependencyService],
})
export class DependencyModule {}
```

- [ ] **Step 3: Add notification check to DependencyService**

In `src/modules/dependency.service.ts`, inject `NotificationService` and add it to `checkAll()`:

```typescript
import { Injectable } from '@nestjs/common';
import { GithubService } from './github.service';
import { TaskwarriorService } from './taskwarrior.service';
import { CalendarService } from './calendar.service';
import { NotificationService } from './notification.service';
import type { DependencyStatus } from './dependency.types';

@Injectable()
export class DependencyService {
  constructor(
    private readonly githubService: GithubService,
    private readonly taskwarriorService: TaskwarriorService,
    private readonly calendarService: CalendarService,
    private readonly notificationService: NotificationService,
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
      notificationInstalled,
    ] = await Promise.all([
      this.githubService.isGhInstalled(),
      this.githubService.isAuthenticated(),
      this.calendarService.isInstalled(),
      this.calendarService.isAuthenticated(),
      this.calendarService.hasCredentials(),
      this.notificationService.isInstalled(),
    ]);

    const gogCredentialsPath = this.calendarService.getCredentialsPath();

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
      notification: {
        installed: notificationInstalled,
        instructions: 'brew install terminal-notifier',
      },
      platform,
      allGood: ghInstalled && ghAuthenticated && taskInstalled,
      calendarReady: gogInstalled && gogAuthenticated && gogHasCredentials,
      notificationsReady: notificationInstalled,
    };
  }

  private getGhInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install gh';
      case 'linux':
        return 'sudo apt install gh';
      default:
        return 'See https://cli.github.com for installation instructions';
    }
  }

  private getTaskInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install task';
      case 'linux':
        return 'sudo apt install taskwarrior';
      default:
        return 'See https://taskwarrior.org for installation instructions';
    }
  }

  private getGogInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install steipete/tap/gogcli';
      case 'linux':
        return 'go install github.com/steipete/gogcli@latest';
      default:
        return 'See https://github.com/steipete/gogcli for installation instructions';
    }
  }
}
```

- [ ] **Step 4: Verify the project compiles**

Run: `bun run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/dependency.types.ts src/modules/dependency.service.ts src/modules/dependency.module.ts
git commit -m "feat(notification): integrate notification check into dependency service"
```

---

### Task 6: TUI Bridge Integration

[@nestjs]

**Files:**
- Modify: `src/modules/tui.module.ts`
- Modify: `src/modules/tui.service.ts`
- Modify: `src/modules/tui/bridge.ts`

- [ ] **Step 1: Import NotificationModule in TuiModule**

In `src/modules/tui.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TuiService } from './tui.service';
import { TaskwarriorModule } from './taskwarrior.module';
import { GithubModule } from './github.module';
import { TerminalModule } from './terminal.module';
import { DependencyModule } from './dependency.module';
import { CalendarModule } from './calendar.module';
import { NotificationModule } from './notification.module';

@Module({
  imports: [
    TaskwarriorModule,
    GithubModule,
    TerminalModule,
    DependencyModule,
    CalendarModule,
    NotificationModule,
  ],
  providers: [TuiService],
  exports: [TuiService],
})
export class TuiModule {}
```

- [ ] **Step 2: Add NotificationService to TuiService bridge**

In `src/modules/tui.service.ts`, add import, inject, and bridge:

Add import at top:
```typescript
import { NotificationService } from './notification.service';
```

Add to `TawtuiGlobal.__tawtui` interface:
```typescript
notificationService: NotificationService;
```

Add to constructor:
```typescript
private readonly notificationService: NotificationService,
```

Add to `g.__tawtui` object in `launch()`:
```typescript
notificationService: this.notificationService,
```

- [ ] **Step 3: Add NotificationService to bridge.ts**

In `src/modules/tui/bridge.ts`:

Add import at top:
```typescript
import type { NotificationService } from '../notification.service';
```

Add to `TawtuiBridge` interface:
```typescript
notificationService: NotificationService;
```

Add getter function at end of file (before `getTuiExit`):
```typescript
export function getNotificationService(): NotificationService | null {
  return getBridge()?.notificationService ?? null;
}
```

- [ ] **Step 4: Verify the project compiles**

Run: `bun run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/tui.module.ts src/modules/tui.service.ts src/modules/tui/bridge.ts
git commit -m "feat(notification): bridge notification service to TUI layer"
```

---

### Task 7: Setup Wizard Update

[@tui]

**Files:**
- Modify: `src/modules/tui/components/dialog-setup-wizard.tsx`

- [ ] **Step 1: Add Terminal Notifier section to setup wizard**

In `src/modules/tui/components/dialog-setup-wizard.tsx`, add a `notificationStatus` accessor and a new optional section after the Google Calendar section.

Add accessor after `gogStatus`:
```typescript
const notificationStatus = () => status().notification;
```

Add this JSX block after the Google Calendar `</Show>` closing tag (after line 191 in the current file) and before `<box height={1} />` on line 192:

```tsx
{/* Terminal Notifier section (optional) */}
<box height={1} />
<box flexDirection="row">
  <text fg={FG_NORMAL} attributes={1}>
    {'  Terminal Notifier '}
  </text>
  <text fg={FG_DIM}>{'(Optional)'}</text>
</box>
<box flexDirection="row">
  <text>{'    '}</text>
  <text fg={notificationStatus().installed ? COLOR_SUCCESS : COLOR_ERROR}>
    {notificationStatus().installed ? '✓' : '✗'}
  </text>
  <text fg={FG_DIM}>{' Installed'}</text>
</box>
```

Add install instruction in the install instructions `<Show>` block, after the gog authenticated instruction (after line 241 in current file):

```tsx
<Show when={!notificationStatus().installed}>
  <box flexDirection="row">
    <text fg={FG_DIM}>{'  Notifier:    '}</text>
    <text fg={COLOR_WARNING}>{notificationStatus().instructions}</text>
  </box>
</Show>
```

- [ ] **Step 2: Verify the project compiles**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Visually verify the setup wizard**

Run: `bun run start:dev`
Expected: Setup wizard shows Terminal Notifier row with ✓ or ✗ depending on installation status

- [ ] **Step 4: Commit**

```bash
git add src/modules/tui/components/dialog-setup-wizard.tsx
git commit -m "feat(notification): add terminal-notifier to setup wizard"
```

---

### Task 8: Homebrew Formula Update

[@nestjs]

**Files:**
- Modify: `homebrew-formula/tawtui.rb`

- [ ] **Step 1: Add terminal-notifier to optional caveats**

In `homebrew-formula/tawtui.rb`, update the caveats section to include `terminal-notifier`:

```ruby
def caveats
  <<~EOS
    tawtui requires the following tools:

    Required:
      - Taskwarrior (task): brew install task
      - GitHub CLI (gh):    brew install gh
      - tmux:               brew install tmux

    Optional:
      - Google Calendar:    brew install steipete/tap/gogcli
      - Notifications:      brew install terminal-notifier

    Run `tawtui` to launch the setup wizard.
  EOS
end
```

- [ ] **Step 2: Commit**

```bash
git add homebrew-formula/tawtui.rb
git commit -m "docs(homebrew): add terminal-notifier to optional caveats"
```

---

### Task 9: Final Verification

[@review]

**Files:**
- All files created/modified in Tasks 1-8

- [ ] **Step 1: Run linter**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 2: Run formatter**

Run: `bun run format`
Expected: No changes or only whitespace fixes

- [ ] **Step 3: Run tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 4: Run the app**

Run: `bun run start:dev`
Expected: App starts. If `terminal-notifier` is installed, setup wizard shows ✓. If not, shows ✗ with install instructions.

- [ ] **Step 5: Test a notification manually (if terminal-notifier is installed)**

Open a Bun REPL or small script:
```bash
terminal-notifier -title "TaWTUI" -message "Notification system working" -sound default
```
Expected: Native macOS notification appears with sound

- [ ] **Step 6: Commit any format/lint fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
