# Oracle Auto-Install Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install missing Python dependencies (mempalace, slacktokens) directly from the Oracle setup screen via `pipx`, eliminating the need to leave the TUI.

**Architecture:** Add a `pipx` availability check to `DependencyService`, an async `installPipxPackage()` method, and wire an `[i] Install` key action through `OracleSetupScreen` → `OracleView` → `DependencyService`. Update all install instructions from `pip` to `pipx`.

**Tech Stack:** NestJS (DependencyService), SolidJS/OpenTUI (OracleSetupScreen, OracleView), Bun.spawn/spawnSync, Jest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/dependency.types.ts` | Modify | Add `pipxInstalled`, `pipxInstallInstructions` to `SlackDepStatus` |
| `src/modules/dependency.service.ts` | Modify | Add pipx check, install method, update instructions |
| `src/modules/tui/components/oracle-setup-screen.tsx` | Modify | Add `[i]` install key, progress/error UI, pipx instructions |
| `src/modules/tui/views/oracle-view.tsx` | Modify | Add `handleInstallDeps`, pass as prop |
| `test/dependency.service.spec.ts` | Modify | Update install instruction assertions, add pipx/install tests |

---

### Task 1: Update SlackDepStatus type and DependencyService detection

[@nestjs]

**Files:**
- Modify: `src/modules/dependency.types.ts:18-29`
- Modify: `src/modules/dependency.service.ts:67-96`
- Modify: `test/dependency.service.spec.ts`

- [ ] **Step 1: Write failing tests for pipx detection and updated install instructions**

Add these tests to `test/dependency.service.spec.ts`. Insert after the existing `'slack status includes install instructions'` test (line 73):

```typescript
it('slack status includes pipx install instructions (not pip)', async () => {
  const status = await service.checkAll();
  expect(status.slack.mempalaceInstallInstructions).toBe(
    'pipx install mempalace',
  );
  expect(status.slack.slacktokensInstallInstructions).toBe(
    'pipx install slacktokens',
  );
});

it('slack status includes pipxInstalled field', async () => {
  const status = await service.checkAll();
  expect(status.slack).toHaveProperty('pipxInstalled');
  expect(typeof status.slack.pipxInstalled).toBe('boolean');
});

it('slack status includes pipxInstallInstructions', async () => {
  const status = await service.checkAll();
  expect(status.slack.pipxInstallInstructions).toBeTruthy();
});
```

Also update the existing `'slack status includes install instructions'` test (line 73-80) to expect `pipx` instead of `pip`:

```typescript
it('slack status includes install instructions', async () => {
  const status = await service.checkAll();
  expect(status.slack.mempalaceInstallInstructions).toBe(
    'pipx install mempalace',
  );
  expect(status.slack.slacktokensInstallInstructions).toBe(
    'pipx install slacktokens',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- --testPathPattern dependency`
Expected: Failures — `pipxInstalled` property missing, instructions still say `pip install`.

- [ ] **Step 3: Add `pipxInstalled` and `pipxInstallInstructions` to SlackDepStatus**

In `src/modules/dependency.types.ts`, update the `SlackDepStatus` interface. Replace lines 18-29:

```typescript
export interface SlackDepStatus {
  /** xoxc + xoxd tokens exist in config */
  hasTokens: boolean;
  /** mempalace CLI is available */
  mempalaceInstalled: boolean;
  /** slacktokens Python package is available for auto-extraction */
  slacktokensInstalled: boolean;
  /** pipx CLI is available for auto-install */
  pipxInstalled: boolean;
  /** Install instruction for mempalace */
  mempalaceInstallInstructions: string;
  /** Install instruction for slacktokens */
  slacktokensInstallInstructions: string;
  /** Install instruction for pipx itself (platform-aware) */
  pipxInstallInstructions: string;
}
```

- [ ] **Step 4: Add `isCommandAvailable` and `getPipxInstallInstructions` to DependencyService**

In `src/modules/dependency.service.ts`, add these two private methods before the closing `}` of the class (after `getGogInstallInstructions`, around line 128):

```typescript
private isCommandAvailable(cmd: string): boolean {
  try {
    const result = Bun.spawnSync([cmd, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

private getPipxInstallInstructions(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'brew install pipx';
    case 'linux':
      return 'sudo apt install pipx';
    default:
      return 'See https://pipx.pypa.io for installation instructions';
  }
}
```

- [ ] **Step 5: Update `checkSlack()` to populate new fields and use `pipx` instructions**

Replace the `checkSlack()` method (lines 67-85) with:

```typescript
private checkSlack(): SlackDepStatus {
  const platform = process.platform;
  const oracleConfig = this.configService.getOracleConfig();
  const hasTokens =
    !!oracleConfig.slack?.xoxcToken && !!oracleConfig.slack?.xoxdCookie;

  const mempalaceInstalled = this.isPythonPackageAvailable(
    'mempalace',
    'status',
  );
  const slacktokensInstalled = this.isPythonPackageAvailable('slacktokens');
  const pipxInstalled = this.isCommandAvailable('pipx');

  return {
    hasTokens,
    mempalaceInstalled,
    slacktokensInstalled,
    pipxInstalled,
    mempalaceInstallInstructions: 'pipx install mempalace',
    slacktokensInstallInstructions: 'pipx install slacktokens',
    pipxInstallInstructions: this.getPipxInstallInstructions(platform),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- --testPathPattern dependency`
Expected: All tests pass.

- [ ] **Step 7: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/dependency.types.ts src/modules/dependency.service.ts test/dependency.service.spec.ts
git commit -m "feat(oracle): add pipx detection and update install instructions from pip to pipx"
```

---

### Task 2: Add `installPipxPackage` method to DependencyService

[@nestjs]

**Files:**
- Modify: `src/modules/dependency.service.ts`
- Modify: `test/dependency.service.spec.ts`

- [ ] **Step 1: Write failing tests for installPipxPackage**

Add these tests at the end of the `describe` block in `test/dependency.service.spec.ts`:

```typescript
describe('installPipxPackage', () => {
  const mockBunSpawn = jest.fn();

  beforeEach(() => {
    (globalThis as Record<string, unknown>).Bun = {
      ...mockBun,
      spawn: mockBunSpawn,
    };
  });

  it('returns success when pipx install succeeds', async () => {
    mockBunSpawn.mockReturnValue({
      exited: Promise.resolve(0),
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
    });

    const result = await service.installPipxPackage('mempalace');
    expect(result.success).toBe(true);
    expect(mockBunSpawn).toHaveBeenCalledWith(
      ['pipx', 'install', 'mempalace'],
      expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
    );
  });

  it('returns error when pipx install fails', async () => {
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Package not found'));
        controller.close();
      },
    });
    mockBunSpawn.mockReturnValue({
      exited: Promise.resolve(1),
      stdout: new ReadableStream(),
      stderr: errorStream,
    });

    const result = await service.installPipxPackage('nonexistent-pkg');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Package not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- --testPathPattern dependency`
Expected: Failure — `installPipxPackage` is not a function.

- [ ] **Step 3: Implement `installPipxPackage` method**

In `src/modules/dependency.service.ts`, add this public method after `checkAll()` (around line 65, before the `private` methods):

```typescript
async installPipxPackage(
  pkg: string,
): Promise<{ success: boolean; error?: string }> {
  const proc = Bun.spawn(['pipx', 'install', pkg], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return {
      success: false,
      error:
        stderr.trim() ||
        `pipx install ${pkg} failed with exit code ${exitCode}`,
    };
  }

  return { success: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- --testPathPattern dependency`
Expected: All tests pass.

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dependency.service.ts test/dependency.service.spec.ts
git commit -m "feat(oracle): add installPipxPackage method for auto-installing Python deps"
```

---

### Task 3: Update OracleSetupScreen with install action UI

[@tui]

**Files:**
- Modify: `src/modules/tui/components/oracle-setup-screen.tsx`

**Context:** The setup screen currently shows install instructions as static text. This task adds:
- An `[i] Install` key action when `pipx` is available and packages are missing
- Installing progress indicator
- Error display on failure
- Pipx-not-found instructions when `pipx` is unavailable

The `onInstallDeps` callback is provided by the parent (`OracleView`), which handles the actual `DependencyService.installPipxPackage()` calls. After a successful install, the parent triggers a recheck automatically — the setup screen just needs to call the callback and show state.

**Key convention:** Lowercase key hints (e.g., `[i]`) mean no shift needed. This matches the existing `[r]` and `[t]` pattern in this component.

- [ ] **Step 1: Add `onInstallDeps` prop and installing state signals**

In `src/modules/tui/components/oracle-setup-screen.tsx`, update the props interface (lines 23-32):

```typescript
interface OracleSetupScreenProps {
  slackStatus: SlackDepStatus;
  onRecheck: () => Promise<void>;
  onTokensSubmit: (
    xoxc: string,
    xoxd: string,
    teamId: string,
    teamName: string,
  ) => Promise<void>;
  onInstallDeps: () => Promise<{ success: boolean; error?: string }>;
}
```

Add new signals right after the existing `checking` signal (after line 57):

```typescript
const [installing, setInstalling] = createSignal(false);
const [installError, setInstallError] = createSignal<string | null>(null);
```

Add a helper to check if there are installable packages:

```typescript
const hasInstallablePackages = () =>
  props.slackStatus.pipxInstalled &&
  (!props.slackStatus.mempalaceInstalled || !props.slackStatus.slacktokensInstalled);
```

- [ ] **Step 2: Add install key handler**

In the `useKeyboard` callback, add this block in the normal mode section (after the `key.name === 't'` handler at line 121, before the closing `});`):

```typescript
if (key.name === 'i' && hasInstallablePackages() && !installing()) {
  key.preventDefault();
  setInstalling(true);
  setInstallError(null);
  void props.onInstallDeps().then((result) => {
    setInstalling(false);
    if (!result.success) {
      setInstallError(result.error ?? 'Installation failed');
    } else {
      handleRecheck();
    }
  });
  return;
}
```

- [ ] **Step 3: Update Step 2 (mempalace) UI to show install button or pipx instructions**

Replace the mempalace "not installed" block (lines 300-307) with:

```tsx
<Show when={!props.slackStatus.mempalaceInstalled}>
  <Show
    when={props.slackStatus.pipxInstalled}
    fallback={
      <>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    Install pipx first: '}</text>
          <text fg={COLOR_WARNING}>
            {props.slackStatus.pipxInstallInstructions}
          </text>
        </box>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    Then: '}</text>
          <text fg={COLOR_WARNING}>
            {props.slackStatus.mempalaceInstallInstructions}
          </text>
        </box>
      </>
    }
  >
    <box flexDirection="row">
      <text fg={FG_DIM}>{'    Or manually: '}</text>
      <text fg={COLOR_WARNING}>
        {props.slackStatus.mempalaceInstallInstructions}
      </text>
    </box>
  </Show>
</Show>
```

- [ ] **Step 4: Update Step 1 (slacktokens) install instructions similarly**

Replace the slacktokens "not installed" fallback block (lines 189-201, the `fallback` prop of the `<Show when={props.slackStatus.slacktokensInstalled}>`) with:

```tsx
fallback={
  <Show
    when={props.slackStatus.pipxInstalled}
    fallback={
      <>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'      Install pipx first: '}</text>
          <text fg={COLOR_WARNING}>
            {props.slackStatus.pipxInstallInstructions}
          </text>
        </box>
        <box flexDirection="row">
          <text fg={FG_DIM}>{'      Then: '}</text>
          <text fg={COLOR_WARNING}>
            {props.slackStatus.slacktokensInstallInstructions}
          </text>
        </box>
      </>
    }
  >
    <box flexDirection="row">
      <text fg={FG_DIM}>{'      Or manually: '}</text>
      <text fg={COLOR_WARNING}>
        {props.slackStatus.slacktokensInstallInstructions}
      </text>
    </box>
  </Show>
}
```

- [ ] **Step 5: Add installing state and error display**

Add this block right before the `{/* Key hints */}` comment (before line 319):

```tsx
{/* Install progress */}
<Show when={installing()}>
  <text fg={ORACLE_GRAD[0]} attributes={1}>
    {'  Installing dependencies...'}
  </text>
  <box height={1} />
</Show>

{/* Install error */}
<Show when={installError()}>
  <box flexDirection="row">
    <text fg={COLOR_ERROR}>{'  ✗ '}</text>
    <text fg={COLOR_ERROR}>{installError()}</text>
  </box>
  <box height={1} />
</Show>
```

- [ ] **Step 6: Add `[i] Install` to key hints area**

Update the key hints section (lines 319-333). Add the install hint after the recheck hint:

```tsx
{/* Key hints */}
<box flexDirection="row">
  <text>{'  '}</text>
  <text fg={ACCENT_PRIMARY} attributes={1}>
    {'[r]'}
  </text>
  <text fg={FG_DIM}>{' Re-check dependencies'}</text>
  <Show when={hasInstallablePackages() && !installing()}>
    <text>{'    '}</text>
    <text fg={ACCENT_PRIMARY} attributes={1}>
      {'[i]'}
    </text>
    <text fg={FG_DIM}>{' Install missing deps'}</text>
  </Show>
  <Show when={!props.slackStatus.hasTokens && !tokenMode()}>
    <text>{'    '}</text>
    <text fg={ACCENT_PRIMARY} attributes={1}>
      {'[t]'}
    </text>
    <text fg={FG_DIM}>{' Enter tokens'}</text>
  </Show>
</box>
```

- [ ] **Step 7: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/tui/components/oracle-setup-screen.tsx
git commit -m "feat(oracle): add auto-install action to OracleSetupScreen"
```

---

### Task 4: Wire OracleView with install handler

[@tui]

**Files:**
- Modify: `src/modules/tui/views/oracle-view.tsx:301-323,518-524`

**Context:** The `OracleView` component is the parent of `OracleSetupScreen`. It already passes `handleRecheck` and `handleTokensSubmit` as callbacks. This task adds `handleInstallDeps` which iterates over missing packages and calls `DependencyService.installPipxPackage()` for each.

The `DependencyService` is accessible via `getDependencyService()` from `bridge.ts` (already imported on line 15). The `depStatus()` signal (line 44) holds the current `DependencyStatus` including `slack.mempalaceInstalled` and `slack.slacktokensInstalled`.

- [ ] **Step 1: Add `handleInstallDeps` function**

In `src/modules/tui/views/oracle-view.tsx`, add this function after the `handleTokensSubmit` function (after line 323):

```typescript
async function handleInstallDeps(): Promise<{
  success: boolean;
  error?: string;
}> {
  const depService = getDependencyService();
  if (!depService) {
    return { success: false, error: 'Dependency service not available' };
  }

  const status = depStatus();
  if (!status) {
    return { success: false, error: 'No dependency status available' };
  }

  const packagesToInstall: string[] = [];
  if (!status.slack.mempalaceInstalled) packagesToInstall.push('mempalace');
  if (!status.slack.slacktokensInstalled)
    packagesToInstall.push('slacktokens');

  for (const pkg of packagesToInstall) {
    const result = await depService.installPipxPackage(pkg);
    if (!result.success) {
      return { success: false, error: `Failed to install ${pkg}: ${result.error}` };
    }
  }

  return { success: true };
}
```

- [ ] **Step 2: Pass `onInstallDeps` prop to OracleSetupScreen**

Update the `<OracleSetupScreen>` JSX (around line 518-524). Add the new prop:

```tsx
<OracleSetupScreen
  slackStatus={depStatus()!.slack}
  onRecheck={handleRecheck}
  onTokensSubmit={handleTokensSubmit}
  onInstallDeps={handleInstallDeps}
/>
```

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: All tests pass (no test changes needed — OracleView has no unit tests, integration is manual).

- [ ] **Step 4: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tui/views/oracle-view.tsx
git commit -m "feat(oracle): wire install handler from OracleView to OracleSetupScreen"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| Static text: `pip install mempalace` | `[i]` key auto-installs via `pipx` |
| No pipx awareness | Detects pipx availability, shows install instructions if missing |
| User must leave TUI to install deps | One keypress installs all missing Python packages |
| No install progress feedback | Shows "Installing...", errors, auto-rechecks on success |
