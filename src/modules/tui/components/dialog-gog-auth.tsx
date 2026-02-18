import { createSignal, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { getCalendarService } from '../bridge';
import type { AuthResult } from '../../calendar.types';
import {
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  BG_INPUT_FOCUS,
  COLOR_SUCCESS,
  COLOR_ERROR,
  ACCENT_TERTIARY,
  ACCENT_PRIMARY,
} from '../theme';

interface DialogGogAuthProps {
  onSuccess: () => void;
  onCancel: () => void;
}

type Mode = 'email' | 'authenticating' | 'result';

export function DialogGogAuth(props: DialogGogAuthProps) {
  const [mode, setMode] = createSignal<Mode>('email');
  const [email, setEmail] = createSignal('');
  const [result, setResult] = createSignal<AuthResult | null>(null);

  let cancelled = false;

  const handleSubmitEmail = () => {
    const addr = email().trim();
    if (!addr) return;

    setMode('authenticating');
    cancelled = false;

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setMode('result');
      return;
    }

    void calService.startAuth(addr).then((res) => {
      if (cancelled) return;
      setResult(res);
      setMode('result');
    });
  };

  useKeyboard((key) => {
    const currentMode = mode();

    if (key.name === 'escape') {
      key.preventDefault();
      key.stopPropagation();

      if (currentMode === 'email' || currentMode === 'authenticating') {
        cancelled = true;
        props.onCancel();
      } else if (currentMode === 'result') {
        if (result()?.success) {
          props.onSuccess();
        } else {
          props.onCancel();
        }
      }
      return;
    }

    if (key.name === 'return') {
      key.preventDefault();
      key.stopPropagation();

      if (currentMode === 'email') {
        handleSubmitEmail();
      } else if (currentMode === 'result') {
        if (result()?.success) {
          props.onSuccess();
        } else {
          setMode('email');
        }
      }
      return;
    }
  });

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <text fg={FG_PRIMARY} attributes={1}>
        {'  Google Calendar Authentication'}
      </text>
      <box height={1} />

      {/* Email mode */}
      <Show when={mode() === 'email'}>
        <box flexDirection="row">
          <box width={8}>
            <text fg={FG_DIM}>{'Email'}</text>
          </box>
          <input
            width={40}
            value={email()}
            placeholder="you@gmail.com"
            focused={true}
            backgroundColor={BG_INPUT_FOCUS}
            textColor={FG_NORMAL}
            onInput={(val: string) => setEmail(val)}
          />
        </box>
        <box height={1} />
        <box flexDirection="row">
          <text fg={COLOR_SUCCESS} attributes={1}>
            {' [Enter] '}
          </text>
          <text fg={FG_DIM}>{'Submit  '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Cancel'}</text>
        </box>
      </Show>

      {/* Authenticating mode */}
      <Show when={mode() === 'authenticating'}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Opening browser for Google authentication...'}
        </text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={FG_MUTED}>{'  Account: '}</text>
          <text fg={FG_NORMAL}>{email()}</text>
        </box>
        <box height={1} />
        <text fg={FG_DIM}>{'  Complete the sign-in in your browser'}</text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Cancel'}</text>
        </box>
      </Show>

      {/* Result mode */}
      <Show when={mode() === 'result'}>
        <Show
          when={result()?.success}
          fallback={
            <>
              <box flexDirection="row">
                <text fg={COLOR_ERROR}>{'  ✗ '}</text>
                <text fg={COLOR_ERROR}>
                  {result()?.error ?? 'Unknown error'}
                </text>
              </box>
              <box height={1} />
              <box flexDirection="row">
                <text fg={COLOR_SUCCESS} attributes={1}>
                  {' [Enter] '}
                </text>
                <text fg={FG_DIM}>{'Retry  '}</text>
                <text fg={ACCENT_PRIMARY} attributes={1}>
                  {' [Esc] '}
                </text>
                <text fg={FG_DIM}>{'Cancel'}</text>
              </box>
            </>
          }
        >
          <box flexDirection="row">
            <text fg={COLOR_SUCCESS}>{'  ✓ '}</text>
            <text fg={COLOR_SUCCESS}>{'Authenticated successfully'}</text>
          </box>
          <box height={1} />
          <box flexDirection="row">
            <text fg={COLOR_SUCCESS} attributes={1}>
              {' [Enter] '}
            </text>
            <text fg={FG_DIM}>{'Close  '}</text>
            <text fg={ACCENT_PRIMARY} attributes={1}>
              {' [Esc] '}
            </text>
            <text fg={FG_DIM}>{'Close'}</text>
          </box>
        </Show>
      </Show>
    </box>
  );
}
