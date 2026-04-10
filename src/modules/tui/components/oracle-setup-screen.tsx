import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { SlackDepStatus } from '../../dependency.types';
import type {
  ExtractedWorkspace,
  ExtractionResult,
} from '../../slack/token-extractor.service';
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
import { lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';
import { getCancelOracleInit, ORACLE_INIT_CANCELLED } from '../bridge';

/** Oracle gradient: purple -> secondary. Re-exported for use by OracleView. */
export const ORACLE_GRAD: [string, string] = [P.purple, P.secondary];

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
    onProgress: (progress: {
      message: string;
      status: 'running' | 'done' | 'skip';
    }) => void,
  ) => Promise<void>;
}

const TOKEN_FIELDS = ['xoxc', 'xoxd', 'teamId', 'teamName'] as const;
type TokenField = (typeof TOKEN_FIELDS)[number];

const TOKEN_LABELS: Record<TokenField, string> = {
  xoxc: 'xoxc Token',
  xoxd: 'xoxd Cookie',
  teamId: 'Team ID',
  teamName: 'Team Name',
};

const TOKEN_PLACEHOLDERS: Record<TokenField, string> = {
  xoxc: 'xoxc-...',
  xoxd: 'xoxd-...',
  teamId: 'T0123ABCDE',
  teamName: 'my-workspace',
};

export function OracleSetupScreen(props: OracleSetupScreenProps) {
  const [tokenMode, setTokenMode] = createSignal(false);
  const [tokenFieldIdx, setTokenFieldIdx] = createSignal(0);
  const [tokenValues, setTokenValues] = createSignal<Record<TokenField, string>>(
    { xoxc: '', xoxd: '', teamId: '', teamName: '' },
  );
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);
  const [detecting, setDetecting] = createSignal(false);
  const [detectedWorkspaces, setDetectedWorkspaces] = createSignal<
    ExtractedWorkspace[]
  >([]);
  const [initializing, setInitializing] = createSignal(false);
  const [initMessages, setInitMessages] = createSignal<
    Array<{ message: string; status: 'running' | 'done' | 'skip' }>
  >([]);
  const [initError, setInitError] = createSignal<string | null>(null);
  const [cancelled, setCancelled] = createSignal(false);

  // Animated spinner for running items
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [spinnerIdx, setSpinnerIdx] = createSignal(0);
  const spinnerTimer = setInterval(
    () => setSpinnerIdx((i) => (i + 1) % SPINNER_FRAMES.length),
    80,
  );
  onCleanup(() => clearInterval(spinnerTimer));

  const hasInstallablePackages = () =>
    props.slackStatus.pipxInstalled && !props.slackStatus.mempalaceInstalled;

  /** Run the oracle initialization pipeline. */
  const runInit = () => {
    setInitializing(true);
    setInitMessages([]);
    setInitError(null);
    setCancelled(false);
    initTriggered = true;
    void props
      .onInitializeOracle((progress) => {
        setInitMessages((prev) => {
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
        const message = err instanceof Error ? err.message : String(err);
        if (message === ORACLE_INIT_CANCELLED) {
          setCancelled(true);
          setInitError(null);
        } else {
          setCancelled(false);
          setInitError(message);
        }
        initTriggered = false;
      });
  };

  // Auto-trigger initialization when steps 1+2 are complete
  let initTriggered = false;
  createEffect(() => {
    if (
      props.slackStatus.hasTokens &&
      props.slackStatus.mempalaceInstalled &&
      !initTriggered &&
      !initializing() &&
      !initError()
    ) {
      runInit();
    }
  });

  const currentTokenField = (): TokenField => TOKEN_FIELDS[tokenFieldIdx()];

  const setField = (field: TokenField, value: string) => {
    setTokenValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleTokenSubmit = () => {
    const vals = tokenValues();
    if (!vals.xoxc.trim() || !vals.xoxd.trim() || !vals.teamId.trim() || !vals.teamName.trim()) {
      return;
    }
    void props.onTokensSubmit(
      vals.xoxc.trim(),
      vals.xoxd.trim(),
      vals.teamId.trim(),
      vals.teamName.trim(),
    );
  };

  const handleRecheck = () => {
    setChecking(true);
    setInstallError(null);
    void props.onRecheck().then(() => setChecking(false));
  };

  useKeyboard((key) => {
    if (tokenMode()) {
      if (key.name === 'escape') {
        key.preventDefault();
        key.stopPropagation();
        setTokenMode(false);
        setTokenFieldIdx(0);
        setTokenValues({ xoxc: '', xoxd: '', teamId: '', teamName: '' });
        return;
      }
      if (key.name === 'tab') {
        key.preventDefault();
        key.stopPropagation();
        setTokenFieldIdx((prev) => (prev + 1) % TOKEN_FIELDS.length);
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        key.stopPropagation();
        handleTokenSubmit();
        return;
      }
      // Let input handle all other keys
      return;
    }

    // Normal mode

    // Cancel initialization with Esc
    if (key.name === 'escape' && initializing()) {
      key.preventDefault();
      const cancel = getCancelOracleInit();
      if (cancel) cancel();
      return;
    }

    // Retry initialization with Enter after cancellation
    if (key.name === 'return' && cancelled() && !initializing()) {
      key.preventDefault();
      runInit();
      return;
    }

    // Auto-detect tokens from Slack app
    if (
      key.name === 'a' &&
      !props.slackStatus.hasTokens &&
      props.slackStatus.slackAppDetected &&
      !detecting()
    ) {
      key.preventDefault();
      setDetecting(true);
      setInstallError(null);
      void props.onAutoDetect().then((result) => {
        setDetecting(false);
        if (!result.success) {
          setInstallError(result.error ?? 'Auto-detect failed');
        } else if (result.workspaces.length === 1) {
          const ws = result.workspaces[0];
          void props.onTokensSubmit(
            ws.xoxcToken,
            ws.xoxdCookie,
            ws.teamId,
            ws.teamName,
          );
        } else {
          setDetectedWorkspaces(result.workspaces);
        }
      });
      return;
    }

    // Workspace selection (1-9) when multiple workspaces detected
    if (detectedWorkspaces().length > 0) {
      const idx = parseInt(key.sequence ?? '', 10);
      if (idx >= 1 && idx <= detectedWorkspaces().length) {
        key.preventDefault();
        const ws = detectedWorkspaces()[idx - 1];
        void props.onTokensSubmit(
          ws.xoxcToken,
          ws.xoxdCookie,
          ws.teamId,
          ws.teamName,
        );
        setDetectedWorkspaces([]);
        return;
      }
      if (key.name === 'escape') {
        key.preventDefault();
        setDetectedWorkspaces([]);
        return;
      }
    }

    if (key.name === 'r') {
      key.preventDefault();
      handleRecheck();
      return;
    }

    if (key.name === 't' && !props.slackStatus.hasTokens) {
      key.preventDefault();
      setTokenMode(true);
      setTokenFieldIdx(0);
      return;
    }

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
  });

  /** Render a gradient-bordered title line. */
  const renderTitle = () => {
    const title = ' Oracle Setup ';
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

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={lerpHex(ORACLE_GRAD[0], ORACLE_GRAD[1], 0.5)}
      paddingX={2}
      paddingY={1}
    >
      {/* Title */}
      {renderTitle()}
      <box height={1} />

      <text fg={FG_DIM}>
        Oracle requires Slack session tokens and the mempalace CLI.
      </text>
      <text fg={FG_DIM}>
        Complete the steps below to enable Oracle.
      </text>
      <box height={1} />

      {/* Step 1: Slack Session Tokens */}
      <box flexDirection="row">
        <text fg={FG_NORMAL} attributes={1}>
          {'  Step 1: '}
        </text>
        <text fg={FG_NORMAL} attributes={1}>
          Slack Session Tokens
        </text>
        <text>{'  '}</text>
        <text fg={props.slackStatus.hasTokens ? COLOR_SUCCESS : COLOR_ERROR}>
          {props.slackStatus.hasTokens ? '✓' : '✗'}
        </text>
      </box>

      <Show when={!props.slackStatus.hasTokens}>
        <box height={1} />

        {/* Auto-detect from Slack app */}
        <Show when={props.slackStatus.slackAppDetected}>
          <text fg={FG_DIM}>{'    Option A (automatic):'}</text>
          <Show
            when={!detecting()}
            fallback={
              <text fg={ORACLE_GRAD[0]} attributes={1}>
                {'      Detecting Slack tokens...'}
              </text>
            }
          >
            <box flexDirection="row">
              <text>{'      '}</text>
              <text fg={ACCENT_PRIMARY} attributes={1}>
                {'[a]'}
              </text>
              <text fg={FG_DIM}>{' Auto-detect from Slack desktop app'}</text>
            </box>
          </Show>
          <box height={1} />
        </Show>

        {/* Workspace selection */}
        <Show when={detectedWorkspaces().length > 0}>
          <text fg={FG_NORMAL} attributes={1}>
            {'    Select a workspace:'}
          </text>
          <For each={detectedWorkspaces()}>
            {(ws, i) => (
              <box flexDirection="row">
                <text>{'      '}</text>
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {`[${i() + 1}]`}
                </text>
                <text fg={FG_NORMAL}>{` ${ws.teamName}`}</text>
                <text fg={FG_DIM}>{` (${ws.teamId})`}</text>
              </box>
            )}
          </For>
          <box flexDirection="row">
            <text>{'      '}</text>
            <text fg={FG_MUTED}>{'[Esc] cancel'}</text>
          </box>
          <box height={1} />
        </Show>

        {/* Manual entry — always available */}
        <text fg={FG_DIM}>
          {props.slackStatus.slackAppDetected
            ? '    Option B (manual):'
            : '    Enter tokens manually:'}
        </text>
        <text fg={FG_DIM}>
          {'      1. Open Slack in your browser (not the desktop app)'}
        </text>
        <text fg={FG_DIM}>
          {'      2. Open DevTools → Application → Cookies'}
        </text>
        <text fg={FG_DIM}>
          {'      3. Copy the "d" cookie value (xoxd-...)'}
        </text>
        <text fg={FG_DIM}>
          {'      4. Open DevTools → Console → run: window.prompt("token", (await (await fetch("/api/auth.findSession", {method: "POST"})).json()).token_id)'}
        </text>
        <text fg={FG_DIM}>
          {'      5. Copy the xoxc-... token from the prompt'}
        </text>
        <box height={1} />

        <box flexDirection="row">
          <text>{'    '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[t]'}
          </text>
          <text fg={FG_DIM}>{' Enter tokens manually'}</text>
        </box>
      </Show>

      {/* Token input form */}
      <Show when={tokenMode()}>
        <box height={1} />
        <text fg={SEPARATOR_COLOR}>{'    ─── Token Input ───'}</text>
        <box height={1} />

        <For each={[...TOKEN_FIELDS]}>
          {(field, idx) => {
            const isFocused = () => tokenFieldIdx() === idx();
            return (
              <box flexDirection="row" height={1}>
                <text>{'    '}</text>
                <box width={14}>
                  <text
                    fg={isFocused() ? FG_NORMAL : FG_DIM}
                    attributes={isFocused() ? 1 : 0}
                  >
                    {isFocused() ? '> ' : '  '}
                    {TOKEN_LABELS[field]}
                  </text>
                </box>
                <input
                  width={50}
                  value={tokenValues()[field]}
                  placeholder={TOKEN_PLACEHOLDERS[field]}
                  focused={isFocused()}
                  backgroundColor={isFocused() ? BG_INPUT_FOCUS : BG_INPUT}
                  textColor={FG_NORMAL}
                  onInput={(val: string) => setField(field, val)}
                />
              </box>
            );
          }}
        </For>

        <box height={1} />
        <box flexDirection="row">
          <text>{'    '}</text>
          <text fg={FG_MUTED}>
            {'[Tab] next field  [Enter] save  [Esc] cancel'}
          </text>
        </box>
      </Show>

      <box height={1} />

      {/* Step 2: mempalace */}
      <box flexDirection="row">
        <text fg={FG_NORMAL} attributes={1}>
          {'  Step 2: '}
        </text>
        <text fg={FG_NORMAL} attributes={1}>
          mempalace
        </text>
        <text>{'  '}</text>
        <text
          fg={props.slackStatus.mempalaceInstalled ? COLOR_SUCCESS : COLOR_ERROR}
        >
          {props.slackStatus.mempalaceInstalled ? '✓' : '✗'}
        </text>
      </box>

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
            <text fg={FG_DIM}>{'    Or run manually: '}</text>
            <text fg={COLOR_WARNING}>
              {props.slackStatus.mempalaceInstallInstructions}
            </text>
          </box>
        </Show>
      </Show>

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
              : props.slackStatus.hasTokens &&
                  props.slackStatus.mempalaceInstalled
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
                    : `${SPINNER_FRAMES[spinnerIdx()]} `}
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
        <Show when={initializing()}>
          <box height={1} />
          <box flexDirection="row">
            <text>{'    '}</text>
            <text fg={FG_DIM}>{'Press '}</text>
            <text fg={FG_DIM} attributes={1}>{'Esc'}</text>
            <text fg={FG_DIM}>{' to cancel'}</text>
          </box>
        </Show>
      </Show>

      {/* Cancelled state */}
      <Show when={cancelled() && !initializing()}>
        <box flexDirection="row">
          <text>{'    '}</text>
          <text fg={COLOR_WARNING}>{'⏸ '}</text>
          <text fg={FG_NORMAL}>{'Cancelled — press '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>{'Enter'}</text>
          <text fg={FG_NORMAL}>{' to retry'}</text>
        </box>
      </Show>

      {/* Init error */}
      <Show when={initError()}>
        <box flexDirection="row">
          <text fg={COLOR_ERROR}>{'    ✗ '}</text>
          <text fg={COLOR_ERROR}>{initError()}</text>
        </box>
      </Show>

      <box height={1} />

      {/* Checking state */}
      <Show when={checking()}>
        <text fg={ORACLE_GRAD[0]} attributes={1}>
          {'  Checking...'}
        </text>
        <box height={1} />
      </Show>

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
        <Show
          when={
            !props.slackStatus.hasTokens &&
            props.slackStatus.slackAppDetected &&
            !detecting() &&
            detectedWorkspaces().length === 0
          }
        >
          <text>{'    '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[a]'}
          </text>
          <text fg={FG_DIM}>{' Auto-detect'}</text>
        </Show>
        <Show when={!props.slackStatus.hasTokens && !tokenMode()}>
          <text>{'    '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[t]'}
          </text>
          <text fg={FG_DIM}>{' Enter tokens'}</text>
        </Show>
      </box>
    </box>
  );
}
