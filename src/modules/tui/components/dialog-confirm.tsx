import { createSignal, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { FG_NORMAL } from '../theme';
import { darkenHex, lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

interface DialogConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const BUTTONS = [
  { label: ' Y Yes ', shortcut: 'y', gradStart: '#5aaa6a', gradEnd: '#2a7a8a' },
  { label: ' N No ', shortcut: 'n', gradStart: '#e05555', gradEnd: '#8a2a2a' },
] as const;

export function DialogConfirm(props: DialogConfirmProps) {
  const [focused, setFocused] = createSignal(0);

  useKeyboard((key) => {
    if (key.name === 'y') {
      props.onConfirm();
      return;
    }
    if (key.name === 'n') {
      props.onCancel();
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
    if (key.name === 'return') {
      if (focused() === 0) {
        props.onConfirm();
      } else {
        props.onCancel();
      }
      return;
    }
  });

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <text fg={FG_NORMAL}>{props.message}</text>
      <box height={1} />
      <box flexDirection="row">
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
