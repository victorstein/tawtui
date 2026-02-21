import { createSignal, Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { DependencyStatus } from '../../dependency.types';
import { useDialog } from '../context/dialog';
import { DialogGogAuth } from './dialog-gog-auth';
import {
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARNING,
  ACCENT_PRIMARY,
  ACCENT_TERTIARY,
  SEPARATOR_COLOR,
} from '../theme';
import { darkenHex, lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

interface DialogSetupWizardProps {
  status: DependencyStatus;
  onCheckAgain: () => Promise<DependencyStatus>;
  onContinue: () => void;
}

const BUTTONS = [
  {
    label: ' [C] Check Again ',
    shortcut: 'c',
    gradStart: '#5a7aaa',
    gradEnd: '#2a4a7a',
  },
  {
    label: ' [Enter] Continue ',
    shortcut: 'return',
    gradStart: '#5aaa6a',
    gradEnd: '#2a7a8a',
  },
] as const;

export function DialogSetupWizard(props: DialogSetupWizardProps) {
  const [status, setStatus] = createSignal<DependencyStatus>(props.status);
  const [focused, setFocused] = createSignal(0);
  const [checking, setChecking] = createSignal(false);
  const dialog = useDialog();

  const ghStatus = () => status().gh;
  const taskStatus = () => status().task;
  const gogStatus = () => status().gog;
  const hasMissing = () =>
    !ghStatus().installed ||
    !ghStatus().authenticated ||
    !taskStatus().installed ||
    !gogStatus().installed ||
    !gogStatus().authenticated;

  useKeyboard((key) => {
    if (checking()) return;

    if (
      key.name === 'a' &&
      gogStatus().installed &&
      !gogStatus().authenticated
    ) {
      key.preventDefault();
      key.stopPropagation();
      dialog.show(
        () => (
          <DialogGogAuth
            onSuccess={() => {
              dialog.close();
              setChecking(true);
              void props.onCheckAgain().then((result) => {
                setStatus(result);
                setChecking(false);
              });
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'large' },
      );
      return;
    }

    if (key.name === 'c') {
      setChecking(true);
      void props.onCheckAgain().then((result) => {
        setStatus(result);
        setChecking(false);
      });
      return;
    }
    if (key.name === 'return') {
      props.onContinue();
      return;
    }
    if (key.name === 'tab') {
      setFocused((prev) => (prev === 0 ? 1 : 0));
      return;
    }
    if (key.name === 'left') {
      setFocused(0);
      return;
    }
    if (key.name === 'right') {
      setFocused(1);
      return;
    }
  });

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Title */}
      <text fg={FG_PRIMARY} attributes={1}>
        {'  Dependency Setup'}
      </text>
      <box height={1} />

      {/* GitHub CLI section */}
      <text fg={FG_NORMAL} attributes={1}>
        {'  GitHub CLI (gh)'}
      </text>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text fg={ghStatus().installed ? COLOR_SUCCESS : COLOR_ERROR}>
          {ghStatus().installed ? '✓' : '✗'}
        </text>
        <text fg={FG_DIM}>{' Installed'}</text>
      </box>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text fg={ghStatus().authenticated ? COLOR_SUCCESS : COLOR_ERROR}>
          {ghStatus().authenticated ? '✓' : '✗'}
        </text>
        <text fg={FG_DIM}>{' Authenticated'}</text>
      </box>
      <box height={1} />

      {/* TaskWarrior section */}
      <text fg={FG_NORMAL} attributes={1}>
        {'  TaskWarrior (task)'}
      </text>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text fg={taskStatus().installed ? COLOR_SUCCESS : COLOR_ERROR}>
          {taskStatus().installed ? '✓' : '✗'}
        </text>
        <text fg={FG_DIM}>{' Installed'}</text>
      </box>
      <box height={1} />

      {/* Google Calendar CLI section */}
      <text fg={FG_NORMAL} attributes={1}>
        {'  Google Calendar CLI (gog)'}
      </text>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text fg={gogStatus().installed ? COLOR_SUCCESS : COLOR_ERROR}>
          {gogStatus().installed ? '✓' : '✗'}
        </text>
        <text fg={FG_DIM}>{' Installed'}</text>
      </box>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text
          fg={
            gogStatus().credentialsConfigured ? COLOR_SUCCESS : COLOR_WARNING
          }
        >
          {gogStatus().credentialsConfigured ? '✓' : '⟳'}
        </text>
        <text fg={FG_DIM}>
          {gogStatus().credentialsConfigured
            ? ' Credentials configured'
            : ' Will auto-configure on auth'}
        </text>
      </box>
      <box flexDirection="row">
        <text>{'    '}</text>
        <text fg={gogStatus().authenticated ? COLOR_SUCCESS : COLOR_ERROR}>
          {gogStatus().authenticated ? '✓' : '✗'}
        </text>
        <text fg={FG_DIM}>{' Authenticated'}</text>
      </box>
      <Show when={gogStatus().installed && !gogStatus().authenticated}>
        <box flexDirection="row">
          <text>{'    '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[A]'}
          </text>
          <text fg={FG_DIM}>{' Authenticate'}</text>
        </box>
      </Show>
      <box height={1} />

      {/* Install instructions — only shown when something is missing */}
      <Show when={hasMissing()}>
        <text fg={SEPARATOR_COLOR}>{'  ─── Install Instructions ───'}</text>
        <box height={1} />

        <Show when={!ghStatus().installed}>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'  GitHub CLI:  '}</text>
            <text fg={COLOR_WARNING}>{ghStatus().instructions}</text>
          </box>
        </Show>

        <Show when={ghStatus().installed && !ghStatus().authenticated}>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'  Auth:        '}</text>
            <text fg={COLOR_WARNING}>{ghStatus().authInstructions}</text>
          </box>
        </Show>

        <Show when={!taskStatus().installed}>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'  TaskWarrior: '}</text>
            <text fg={COLOR_WARNING}>{taskStatus().instructions}</text>
          </box>
        </Show>

        <Show when={!gogStatus().installed}>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'  Google Cal:  '}</text>
            <text fg={COLOR_WARNING}>{gogStatus().instructions}</text>
          </box>
        </Show>

        <Show when={gogStatus().installed && !gogStatus().authenticated}>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'  Cal Auth:    '}</text>
            <text fg={COLOR_WARNING}>{'Press [A] to authenticate'}</text>
          </box>
        </Show>

        <box height={1} />
        <text fg={SEPARATOR_COLOR}>{'  ───'}</text>
      </Show>

      <box height={1} />

      {/* Checking state */}
      <Show when={checking()}>
        <text fg={ACCENT_TERTIARY} attributes={1}>
          {'  Checking...'}
        </text>
        <box height={1} />
      </Show>

      {/* Buttons */}
      <box flexDirection="row">
        <text>{'  '}</text>
        <For each={BUTTONS}>
          {(btn, idx) => {
            const isFocused = () => focused() === idx();
            const chars = btn.label.split('');
            const dimBg = darkenHex(btn.gradStart, 0.3);
            return (
              <>
                {idx() > 0 && <text>{'  '}</text>}
                <box flexDirection="row">
                  {isFocused() ? (
                    <>
                      <text fg={btn.gradStart}>{LEFT_CAP}</text>
                      <For each={chars}>
                        {(char, i) => {
                          const t =
                            chars.length > 1 ? i() / (chars.length - 1) : 0;
                          return (
                            <text
                              fg="#ffffff"
                              bg={lerpHex(btn.gradStart, btn.gradEnd, t)}
                              attributes={1}
                            >
                              {char}
                            </text>
                          );
                        }}
                      </For>
                      <text fg={btn.gradEnd}>{RIGHT_CAP}</text>
                    </>
                  ) : (
                    <>
                      <text fg={dimBg}>{LEFT_CAP}</text>
                      <text fg={btn.gradStart} bg={dimBg}>
                        {btn.label}
                      </text>
                      <text fg={dimBg}>{RIGHT_CAP}</text>
                    </>
                  )}
                </box>
              </>
            );
          }}
        </For>
      </box>
    </box>
  );
}
