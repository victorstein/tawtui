import {
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  batch,
  Show,
  For,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions, usePaste, useRenderer } from '@opentui/solid';
import type { ScrollBoxRenderable } from '@opentui/core';
import { OracleSetupScreen, ORACLE_GRAD } from '../components/oracle-setup-screen';
import { TerminalOutput } from '../components/terminal-output';
import { DialogConfirm } from '../components/dialog-confirm';
import { useDialog } from '../context/dialog';
import { useToast } from '../context/toast';
import {
  getDependencyService,
  getTerminalService,
  getConfigService,
  getSlackIngestionService,
  getCreateOracleSession,
  getExtractSlackTokens,
  getInitializeOracle,
  getResetOracleData,
} from '../bridge';
import type { ExtractionResult } from '../../slack/token-extractor.service';
import type { DependencyStatus, SlackDepStatus } from '../../dependency.types';
import type { CaptureResult } from '../../terminal.types';
import {
  FG_PRIMARY,
  FG_DIM,
  FG_MUTED,
  FG_NORMAL,
  COLOR_SUCCESS,
  COLOR_ERROR,
  ACCENT_PRIMARY,
} from '../theme';
import { lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

interface OracleViewProps {
  refreshTrigger?: () => number;
  onInputCapturedChange?: (captured: boolean) => void;
  onOracleReadyChange?: (ready: boolean) => void;
  initialReady?: boolean;
}

export function OracleView(props: OracleViewProps) {
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const dialog = useDialog();
  const toast = useToast();

  // Dependency status
  const [depStatus, setDepStatus] = createSignal<DependencyStatus | null>(null);
  const [oracleReady, setOracleReady] = createSignal(props.initialReady ?? false);

  // Guard: when true, checkDependencies() won't set oracleReady to true.
  // Prevents premature transition while initializeOracle is in-flight.
  let initInProgress = false;

  // Session state
  const [oracleSessionId, setOracleSessionId] = createSignal<string | null>(
    null,
  );
  const [capture, setCapture] = createSignal<CaptureResult | null>(null);

  // Interactive mode
  const [interactive, setInteractive] = createSignal(false);

  // Terminal scroll ref
  const [terminalScrollRef, setTerminalScrollRef] =
    createSignal<ScrollBoxRenderable | undefined>();

  // Error display
  const [error, setError] = createSignal<string | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function showError(message: string): void {
    setError(message);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => setError(null), 5000);
  }

  // Propagate interactive state to parent
  createEffect(() => {
    props.onInputCapturedChange?.(interactive());
  });

  // Propagate oracle readiness to parent
  createEffect(() => {
    props.onOracleReadyChange?.(oracleReady());
  });

  // ------------------------------------------------------------------
  // Dependency checking
  // ------------------------------------------------------------------

  async function checkDependencies(): Promise<void> {
    const depService = getDependencyService();
    if (!depService) return;
    const status = await depService.checkAll();
    // Batch both updates so the setup screen doesn't mount between
    // setDepStatus (makes condition truthy) and setOracleReady (makes it falsy).
    // Without batch, setDepStatus triggers reactive mount of OracleSetupScreen
    // while oracleReady is still false, causing a spurious re-initialization.
    batch(() => {
      setDepStatus(status);
      if (!(initInProgress && status.oracleReady)) {
        setOracleReady(status.oracleReady);
      }
    });
  }

  // ------------------------------------------------------------------
  // Session detection
  // ------------------------------------------------------------------

  function detectExistingSession(): void {
    const ts = getTerminalService();
    if (!ts) return;
    const sessions = ts.listSessions();
    const existing = sessions.find(
      (s) => s.isOracleSession && s.status === 'running',
    );
    if (existing) {
      setOracleSessionId(existing.id);
    }
  }

  // ------------------------------------------------------------------
  // Terminal capture
  // ------------------------------------------------------------------

  async function refreshCapture(): Promise<void> {
    const ts = getTerminalService();
    const sessionId = oracleSessionId();
    if (!ts || !sessionId) {
      setCapture(null);
      return;
    }
    try {
      const result = await ts.captureOutput(sessionId);
      if (result.changed || capture() === null) {
        setCapture(result);
      }
    } catch {
      // Session may have been destroyed
      setOracleSessionId(null);
      setCapture(null);
    }
  }

  async function resizeTmuxPane(): Promise<void> {
    const ts = getTerminalService();
    const sessionId = oracleSessionId();
    if (!ts || !sessionId) return;

    const termWidth = dimensions().width;
    const termHeight = dimensions().height;
    // Full width minus border padding
    const cols = Math.max(termWidth - 4, 10);
    const rows = Math.max(termHeight - 8, 5);

    try {
      await ts.resize(sessionId, cols, rows);
    } catch {
      // Ignore resize errors
    }
  }

  // ------------------------------------------------------------------
  // Adaptive polling
  // ------------------------------------------------------------------

  let pollVersion = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function getPollInterval(): number {
    if (!oracleSessionId()) return 2000;
    if (interactive()) return 80;
    return 300;
  }

  function schedulePoll(version: number): void {
    pollTimer = setTimeout(() => {
      if (version !== pollVersion) return;
      void (async () => {
        if (version !== pollVersion) return;
        await refreshCapture();
        if (version === pollVersion) schedulePoll(version);
      })();
    }, getPollInterval());
  }

  function restartPolling(): void {
    pollVersion++;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    schedulePoll(pollVersion);
  }

  // ------------------------------------------------------------------
  // Ingestion auto-start
  // ------------------------------------------------------------------

  function startIngestionIfNeeded(): void {
    const ingestion = getSlackIngestionService();
    if (!ingestion) return;
    if (!ingestion.isPolling()) {
      const config = getConfigService();
      const intervalMs = (config?.getOracleConfig().pollIntervalSeconds ?? 300) * 1000;
      ingestion.startPolling(intervalMs);
    }
  }

  // ------------------------------------------------------------------
  // Effects and lifecycle
  // ------------------------------------------------------------------

  // Resize effect with debounce when session changes or terminal resizes
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    dimensions(); // re-run on terminal resize
    const sessionId = oracleSessionId();

    if (sessionId) {
      setCapture(null);
      void refreshCapture();
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(() => {
        void resizeTmuxPane();
      }, 50);
    } else {
      setCapture(null);
    }
  });

  // Restart polling when relevant state changes
  createEffect(() => {
    interactive();
    void oracleSessionId();
    restartPolling();
  });

  // Auto-start ingestion when oracleReady transitions to true
  createEffect(
    on(oracleReady, (ready) => {
      if (ready) {
        startIngestionIfNeeded();
      }
    }),
  );

  onMount(() => {
    void checkDependencies();
    detectExistingSession();
  });

  onCleanup(() => {
    pollVersion++;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  });

  // Reload when parent bumps refreshTrigger
  createEffect(
    on(
      () => props.refreshTrigger?.(),
      () => {
        void checkDependencies();
        detectExistingSession();
      },
      { defer: true },
    ),
  );

  // ------------------------------------------------------------------
  // Session actions
  // ------------------------------------------------------------------

  async function startOracleSession(): Promise<void> {
    const createSession = getCreateOracleSession();
    if (!createSession) {
      showError('Oracle session creator not available');
      return;
    }

    try {
      const result = await createSession();
      setOracleSessionId(result.sessionId);
    } catch {
      showError('Failed to start Oracle session');
    }
  }

  async function killOracleSession(): Promise<void> {
    const ts = getTerminalService();
    const sessionId = oracleSessionId();
    if (!ts || !sessionId) return;

    try {
      await ts.destroySession(sessionId);
    } catch {
      showError('Failed to destroy Oracle session');
    }
    setOracleSessionId(null);
    setCapture(null);
    setInteractive(false);
  }

  function showResetConfirmation(): void {
    dialog.show(
      () => (
        <DialogConfirm
          message="Reset all Oracle data? This will clear mined conversations and re-fetch from Slack."
          onConfirm={() => {
            dialog.close();
            void (async () => {
              const resetFn = getResetOracleData();
              if (!resetFn) {
                showError('Reset function not available');
                return;
              }
              try {
                // Kill active session first if present
                if (oracleSessionId()) {
                  await killOracleSession();
                }
                await resetFn();
                setOracleReady(false);
                setOracleSessionId(null);
                // Update depStatus synchronously — don't call checkDependencies() which
                // would race with the auto-trigger's initializeOracle.
                // The setup screen's onRecheck will call checkDependencies() after init completes.
                setDepStatus((prev) =>
                  prev
                    ? { ...prev, oracleInitialized: false, oracleReady: false }
                    : null,
                );
              } catch {
                showError('Failed to reset Oracle data');
              }
            })();
          }}
          onCancel={() => dialog.close()}
        />
      ),
      {
        size: 'medium',
        gradStart: ORACLE_GRAD[0],
        gradEnd: ORACLE_GRAD[1],
      },
    );
  }

  // ------------------------------------------------------------------
  // Setup screen callbacks
  // ------------------------------------------------------------------

  async function handleRecheck(): Promise<void> {
    await checkDependencies();
  }

  async function handleTokensSubmit(
    xoxc: string,
    xoxd: string,
    teamId: string,
    teamName: string,
  ): Promise<void> {
    const config = getConfigService();
    if (!config) return;

    config.updateOracleConfig({
      slack: {
        xoxcToken: xoxc,
        xoxdCookie: xoxd,
        teamId,
        teamName,
      },
    });
    await checkDependencies();
  }

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

    for (const pkg of packagesToInstall) {
      const result = await depService.installPipxPackage(pkg);
      if (!result.success) {
        return { success: false, error: `Failed to install ${pkg}: ${result.error}` };
      }
    }

    return { success: true };
  }

  async function handleAutoDetect(): Promise<ExtractionResult> {
    const extractTokens = getExtractSlackTokens();
    if (!extractTokens) {
      return {
        success: false,
        workspaces: [],
        error: 'Token extractor not available',
      };
    }

    return extractTokens();
  }

  async function handleInitializeOracle(
    onProgress: (progress: {
      message: string;
      status: 'running' | 'done' | 'skip';
    }) => void,
  ): Promise<void> {
    const initOracle = getInitializeOracle();
    if (!initOracle) {
      throw new Error('Oracle initializer not available');
    }
    initInProgress = true;
    try {
      await initOracle(onProgress);
    } finally {
      initInProgress = false;
    }
  }

  // ------------------------------------------------------------------
  // Keyboard handling
  // ------------------------------------------------------------------

  useKeyboard((key) => {
    // Alt+C: Copy selected text to clipboard
    if ((key.option && key.name === 'c') || key.sequence === 'ç') {
      const selection = renderer.getSelection();
      if (selection && selection.isActive) {
        const text = selection.getSelectedText();
        if (text) {
          renderer.copyToClipboardOSC52(text);
          renderer.clearSelection();
        }
      }
      return;
    }

    // Alt+V: Paste system clipboard to tmux
    if ((key.option && key.name === 'v') || key.sequence === '√') {
      const sessionId = oracleSessionId();
      if (!sessionId) return;
      const ts = getTerminalService();
      if (!ts) return;
      void (async () => {
        try {
          const proc = Bun.spawn(['pbpaste'], {
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const text = await new Response(proc.stdout).text();
          await proc.exited;
          if (text) await ts.pasteText(sessionId, text);
        } catch {
          showError('Clipboard read failed');
        }
      })();
      return;
    }

    // Interactive mode: Ctrl+\ exits, all other keys forwarded to tmux
    if (interactive()) {
      if (key.sequence === '\x1c') {
        setInteractive(false);
        return;
      }

      if (key.name === 'escape') {
        const ts = getTerminalService();
        const sessionId = oracleSessionId();
        if (ts && sessionId) {
          ts.sendInput(sessionId, 'escape').catch(() => {});
        }
        return;
      }

      const ts = getTerminalService();
      const sessionId = oracleSessionId();
      if (!ts || !sessionId) return;

      if (key.ctrl && key.name) {
        const ctrlKey = `C-${key.name}`;
        ts.sendInput(sessionId, ctrlKey).catch(() => {
          setInteractive(false);
          setOracleSessionId(null);
        });
        return;
      }

      const input =
        key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta
          ? key.sequence
          : (key.name ?? key.sequence ?? '');
      ts.sendInput(sessionId, input).catch(() => {
        setInteractive(false);
        setOracleSessionId(null);
      });
      return;
    }

    // Non-interactive: only handle when oracle is ready
    if (!oracleReady()) {
      // [r] recheck dependencies even in setup mode
      if (key.name === 'r') {
        const id = toast.show('Checking dependencies...');
        checkDependencies().then(
          () => toast.update(id, 'Dependencies checked', 'done'),
          () => toast.update(id, 'Check failed', 'error'),
        );
        return;
      }
      return;
    }

    // Terminal scroll: Ctrl+D / Ctrl+U (half-page)
    if (key.ctrl && key.name === 'd') {
      terminalScrollRef()?.scrollBy(0.5, 'viewport');
      return;
    }
    if (key.ctrl && key.name === 'u') {
      terminalScrollRef()?.scrollBy(-0.5, 'viewport');
      return;
    }

    // [N] Start new Oracle session
    if (key.name === 'N' || (key.shift && key.name === 'n')) {
      if (!oracleSessionId()) {
        void startOracleSession();
      }
      return;
    }

    // [K] Kill Oracle session
    if (key.name === 'K' || (key.shift && key.name === 'k')) {
      if (oracleSessionId()) {
        void killOracleSession();
      }
      return;
    }

    // [i] Enter interactive mode
    if (key.name === 'i') {
      if (oracleSessionId()) {
        setInteractive(true);
      }
      return;
    }

    // [R] Reset Oracle data (must check before lowercase r)
    if (key.name === 'r' && key.shift) {
      if (oracleReady() && !dialog.isOpen()) {
        showResetConfirmation();
      }
      return;
    }

    // [r] Recheck dependencies
    if (key.name === 'r' && !key.shift) {
      const id = toast.show('Checking dependencies...');
      checkDependencies().then(
        () => {
          const status = depStatus();
          if (status?.oracleReady) {
            toast.update(id, 'All good', 'done');
          } else if (status?.oracleInitialized === false) {
            toast.update(id, 'Oracle not initialized', 'error');
          } else {
            toast.update(id, 'Dependencies checked', 'done');
          }
        },
        () => {
          toast.update(id, 'Check failed', 'error');
        },
      );
      detectExistingSession();
      return;
    }
  });

  usePaste((event) => {
    if (!interactive()) return;
    const ts = getTerminalService();
    const sessionId = oracleSessionId();
    if (!ts || !sessionId) return;
    ts.pasteText(sessionId, event.text).catch(() => showError('Paste failed'));
  });

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const gradColor = () => lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5);

  /** Render a gradient-bordered ORACLE title pill. */
  const renderTitlePill = () => {
    const title = ' ORACLE ';
    const chars = title.split('');
    return (
      <box flexDirection="row">
        <text fg={ORACLE_GRAD[0]}>{LEFT_CAP}</text>
        <For each={chars}>
          {(char, i) => {
            const t = chars.length > 1 ? i() / (chars.length - 1) : 0;
            return (
              <text
                fg="#ffffff"
                bg={lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], t)}
                attributes={1}
              >
                {char}
              </text>
            );
          }}
        </For>
        <text fg={ORACLE_GRAD[1]}>{RIGHT_CAP}</text>
      </box>
    );
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <Show when={error()}>
        <box height={1}>
          <text fg={COLOR_ERROR}> {error()}</text>
        </box>
      </Show>

      {/* Loading state */}
      <Show when={depStatus() === null}>
        <box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
          <text fg={FG_DIM}>Checking Oracle configuration...</text>
        </box>
      </Show>

      {/* Setup screen when not ready */}
      <Show when={depStatus() !== null && !oracleReady()}>
        <OracleSetupScreen
          slackStatus={depStatus()!.slack}
          oracleInitialized={depStatus()!.oracleInitialized}
          onRecheck={handleRecheck}
          onTokensSubmit={handleTokensSubmit}
          onInstallDeps={handleInstallDeps}
          onAutoDetect={handleAutoDetect}
          onInitializeOracle={handleInitializeOracle}
        />
      </Show>

      {/* Oracle session view when ready */}
      <Show when={oracleReady()}>
        <box
          flexDirection="column"
          flexGrow={1}
          borderStyle={interactive() ? 'double' : 'single'}
          borderColor={interactive() ? COLOR_SUCCESS : gradColor()}
        >
          {/* Header */}
          <box height={1} width="100%" paddingX={1} flexDirection="row">
            {renderTitlePill()}
            <text>{'  '}</text>
            <Show
              when={oracleSessionId()}
              fallback={<text fg={FG_MUTED}>No session</text>}
            >
              <text fg={COLOR_SUCCESS}>Session active</text>
              <Show when={interactive()}>
                <text>{'  '}</text>
                <text fg={COLOR_SUCCESS} attributes={1}>
                  INTERACTIVE
                </text>
                <text fg={FG_DIM}>{' — Ctrl+\\ to exit'}</text>
              </Show>
            </Show>
          </box>

          {/* No session: prompt to start */}
          <Show when={!oracleSessionId()}>
            <box
              flexDirection="column"
              flexGrow={1}
              paddingX={2}
              paddingY={1}
            >
              <text fg={FG_NORMAL}>
                No Oracle session is running.
              </text>
              <box height={1} />
              <box flexDirection="row">
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {'[N]'}
                </text>
                <text fg={FG_DIM}>{' Start Oracle session'}</text>
              </box>
              <box flexDirection="row">
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {'[r]'}
                </text>
                <text fg={FG_DIM}>{' Re-check dependencies'}</text>
              </box>
            </box>
          </Show>

          {/* Active session: terminal output */}
          <Show when={oracleSessionId()}>
            <TerminalOutput
              capture={capture()}
              isActivePane={true}
              isInteractive={interactive()}
              agentName="Oracle"
              onScrollRef={setTerminalScrollRef}
            />

            {/* Footer key hints (only when not interactive) */}
            <Show when={!interactive()}>
              <box height={1} width="100%" paddingX={1} flexDirection="row">
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {'[i]'}
                </text>
                <text fg={FG_DIM}>{' Interactive'}</text>
                <text>{'  '}</text>
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {'[K]'}
                </text>
                <text fg={FG_DIM}>{' Kill'}</text>
                <text>{'  '}</text>
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {'[r]'}
                </text>
                <text fg={FG_DIM}>{' Refresh'}</text>
              </box>
            </Show>
          </Show>
        </box>
      </Show>
    </box>
  );
}
