import { createSignal, Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { SlackDepStatus } from '../../dependency.types';
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

/** Oracle gradient: purple -> secondary. Re-exported for use by OracleView. */
export const ORACLE_GRAD: [string, string] = [P.purple, P.secondary];

interface OracleSetupScreenProps {
  slackStatus: SlackDepStatus;
  onRecheck: () => Promise<void>;
  onTokensSubmit: (
    xoxc: string,
    xoxd: string,
    teamId: string,
    teamName: string,
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
        <text fg={FG_DIM}>{'    Option A (automatic):'}</text>
        <Show
          when={props.slackStatus.slacktokensInstalled}
          fallback={
            <>
              <box flexDirection="row">
                <text fg={FG_DIM}>{'      Install: '}</text>
                <text fg={COLOR_WARNING}>
                  {props.slackStatus.slacktokensInstallInstructions}
                </text>
              </box>
              <box flexDirection="row">
                <text fg={FG_DIM}>{'      Then run: '}</text>
                <text fg={COLOR_WARNING}>slacktokens</text>
              </box>
            </>
          }
        >
          <box flexDirection="row">
            <text fg={FG_DIM}>{'      Run: '}</text>
            <text fg={COLOR_WARNING}>slacktokens</text>
          </box>
        </Show>

        <box height={1} />
        <text fg={FG_DIM}>{'    Option B (manual):'}</text>
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
            {'[T]'}
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
        <box flexDirection="row">
          <text fg={FG_DIM}>{'    Install: '}</text>
          <text fg={COLOR_WARNING}>
            {props.slackStatus.mempalaceInstallInstructions}
          </text>
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

      {/* Key hints */}
      <box flexDirection="row">
        <text>{'  '}</text>
        <text fg={ACCENT_PRIMARY} attributes={1}>
          {'[R]'}
        </text>
        <text fg={FG_DIM}>{' Re-check dependencies'}</text>
        <Show when={!props.slackStatus.hasTokens && !tokenMode()}>
          <text>{'    '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[T]'}
          </text>
          <text fg={FG_DIM}>{' Enter tokens'}</text>
        </Show>
      </box>
    </box>
  );
}
