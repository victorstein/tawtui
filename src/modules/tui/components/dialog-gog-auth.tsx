import { createSignal, createEffect, Show } from 'solid-js';
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
  COLOR_WARNING,
  ACCENT_TERTIARY,
  ACCENT_PRIMARY,
} from '../theme';

interface DialogGogAuthProps {
  onSuccess: () => void;
  onCancel: () => void;
}

type Mode =
  | 'checking'
  | 'credentials'
  | 'importing'
  | 'email'
  | 'authenticating'
  | 'result';

export function DialogGogAuth(props: DialogGogAuthProps) {
  const [mode, setMode] = createSignal<Mode>('checking');
  const [email, setEmail] = createSignal('');
  const [credPath, setCredPath] = createSignal('');
  const [result, setResult] = createSignal<AuthResult | null>(null);
  const [errorSource, setErrorSource] = createSignal<'credentials' | 'auth'>(
    'auth',
  );

  let cancelled = false;

  // Check credentials on mount
  createEffect(() => {
    if (mode() !== 'checking') return;

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setErrorSource('credentials');
      setMode('result');
      return;
    }

    void calService.hasCredentials().then((has) => {
      if (cancelled) return;
      if (has) {
        setMode('email');
      } else {
        setMode('credentials');
      }
    });
  });

  const handleImportCredentials = () => {
    const path = credPath().trim();
    if (!path) return;

    setMode('importing');

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setErrorSource('credentials');
      setMode('result');
      return;
    }

    void calService.importCredentials(path).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setMode('email');
      } else {
        setResult(res);
        setErrorSource('credentials');
        setMode('result');
      }
    });
  };

  const handleSubmitEmail = () => {
    const addr = email().trim();
    if (!addr) return;

    setMode('authenticating');
    cancelled = false;

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setErrorSource('auth');
      setMode('result');
      return;
    }

    void calService.startAuth(addr).then((res) => {
      if (cancelled) return;
      setResult(res);
      setErrorSource('auth');
      setMode('result');
    });
  };

  useKeyboard((key) => {
    const currentMode = mode();

    if (key.name === 'escape') {
      key.preventDefault();
      key.stopPropagation();

      if (
        currentMode === 'email' ||
        currentMode === 'authenticating' ||
        currentMode === 'credentials'
      ) {
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

      if (currentMode === 'credentials') {
        handleImportCredentials();
      } else if (currentMode === 'email') {
        handleSubmitEmail();
      } else if (currentMode === 'result') {
        if (result()?.success) {
          props.onSuccess();
        } else {
          // Retry — go back to the step that failed
          if (errorSource() === 'credentials') {
            setMode('credentials');
          } else {
            setMode('email');
          }
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

      {/* Checking mode */}
      <Show when={mode() === 'checking'}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Checking credentials...'}
        </text>
      </Show>

      {/* Credentials mode */}
      <Show when={mode() === 'credentials'}>
        <text fg={COLOR_WARNING} attributes={1}>
          {'  OAuth credentials required'}
        </text>
        <text fg={FG_DIM}>
          {'  1. Go to console.cloud.google.com/apis/credentials'}
        </text>
        <text fg={FG_DIM}>
          {'  2. Create Credentials → OAuth client ID → Desktop app'}
        </text>
        <text fg={FG_DIM}>{'  3. Download the JSON file'}</text>
        <text fg={FG_DIM}>{'  4. Enter the file path below'}</text>
        <box height={1} />
        <box flexDirection="row">
          <box width={8}>
            <text fg={FG_DIM}>{'File'}</text>
          </box>
          <input
            width={40}
            value={credPath()}
            placeholder="/path/to/client_secret.json"
            focused={true}
            backgroundColor={BG_INPUT_FOCUS}
            textColor={FG_NORMAL}
            onInput={(val: string) => setCredPath(val)}
          />
        </box>
        <box height={1} />
        <box flexDirection="row">
          <text fg={COLOR_SUCCESS} attributes={1}>
            {' [Enter] '}
          </text>
          <text fg={FG_DIM}>{'Import  '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Cancel'}</text>
        </box>
      </Show>

      {/* Importing mode */}
      <Show when={mode() === 'importing'}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Importing credentials...'}
        </text>
      </Show>

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
