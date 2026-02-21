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

type Mode = 'email' | 'choose' | 'authenticating' | 'setup' | 'url' | 'result';

export function DialogGogAuth(props: DialogGogAuthProps) {
  const [mode, setMode] = createSignal<Mode>('email');
  const [email, setEmail] = createSignal('');
  const [result, setResult] = createSignal<AuthResult | null>(null);
  const [authUrl, setAuthUrl] = createSignal('');
  const [redirectUrl, setRedirectUrl] = createSignal('');

  let cancelled = false;
  let completeAuth: ((url: string) => Promise<AuthResult>) | null = null;

  const handleSubmitEmail = () => {
    const addr = email().trim();
    if (!addr) return;
    setMode('choose');
  };

  const handleBrowserAuth = () => {
    setMode('authenticating');
    cancelled = false;

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setMode('result');
      return;
    }

    void calService.startAuth(email().trim()).then((res) => {
      if (cancelled) return;
      setResult(res);
      setMode('result');
    });
  };

  const handleManualAuth = () => {
    const addr = email().trim();
    if (!addr) return;

    setMode('setup');
    cancelled = false;

    const calService = getCalendarService();
    if (!calService) {
      setResult({ success: false, error: 'Calendar service not available' });
      setMode('result');
      return;
    }

    void calService.startAuthManual(addr).then((res) => {
      if (cancelled) return;
      if ('authUrl' in res) {
        setAuthUrl(res.authUrl);
        completeAuth = res.complete;
        setMode('url');
      } else {
        setResult(res);
        setMode('result');
      }
    });
  };

  const handleSubmitRedirect = () => {
    const url = redirectUrl().trim();
    if (!url || !completeAuth) return;

    setMode('authenticating');

    void completeAuth(url).then((res) => {
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

      if (currentMode === 'choose') {
        setMode('email');
      } else if (
        currentMode === 'email' ||
        currentMode === 'authenticating' ||
        currentMode === 'setup' ||
        currentMode === 'url'
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

      if (currentMode === 'email') {
        handleSubmitEmail();
      } else if (currentMode === 'choose') {
        handleBrowserAuth();
      } else if (currentMode === 'url') {
        handleSubmitRedirect();
      } else if (currentMode === 'result') {
        if (result()?.success) {
          props.onSuccess();
        } else {
          setMode('email');
        }
      }
      return;
    }

    if (key.sequence === 'm' || key.sequence === 'M') {
      if (currentMode === 'choose') {
        key.preventDefault();
        key.stopPropagation();
        handleManualAuth();
      }
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

      {/* Choose mode */}
      <Show when={mode() === 'choose'}>
        <box flexDirection="row">
          <text fg={FG_MUTED}>{'  Account: '}</text>
          <text fg={FG_NORMAL}>{email()}</text>
        </box>
        <box height={1} />
        <text fg={FG_DIM}>{'  Choose authentication method:'}</text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={COLOR_SUCCESS} attributes={1}>
            {' [Enter] '}
          </text>
          <text fg={FG_DIM}>{'Open Browser  '}</text>
          <text fg={ACCENT_TERTIARY} attributes={1}>
            {' [M] '}
          </text>
          <text fg={FG_DIM}>{'Manual (paste URL)  '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Back'}</text>
        </box>
      </Show>

      {/* Authenticating mode */}
      <Show when={mode() === 'authenticating'}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Setting up and opening browser...'}
        </text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={FG_MUTED}>{'  Account: '}</text>
          <text fg={FG_NORMAL}>{email()}</text>
        </box>
        <box height={1} />
        <text fg={FG_DIM}>{'  Complete the sign-in in your browser'}</text>
        <text fg={FG_DIM}>{'  Credentials are configured automatically'}</text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Cancel'}</text>
        </box>
      </Show>

      {/* Setup mode */}
      <Show when={mode() === 'setup'}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Setting up manual authentication...'}
        </text>
        <box height={1} />
        <box flexDirection="row">
          <text fg={FG_MUTED}>{'  Account: '}</text>
          <text fg={FG_NORMAL}>{email()}</text>
        </box>
        <box height={1} />
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {' [Esc] '}
          </text>
          <text fg={FG_DIM}>{'Cancel'}</text>
        </box>
      </Show>

      {/* URL mode */}
      <Show when={mode() === 'url'}>
        <text fg={FG_DIM}>{'  Open this URL in a browser (click or copy):'}</text>
        <box height={1} />
        <a href={authUrl()} fg={ACCENT_PRIMARY}>{`  ${authUrl()}`}</a>
        <box height={1} />
        <text fg={FG_DIM}>{'  After authorizing, paste the redirect URL:'}</text>
        <box height={1} />
        <box flexDirection="row">
          <text>{'  '}</text>
          <input
            width={60}
            value={redirectUrl()}
            placeholder="http://localhost/..."
            focused={true}
            backgroundColor={BG_INPUT_FOCUS}
            textColor={FG_NORMAL}
            onInput={(val: string) => setRedirectUrl(val)}
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
