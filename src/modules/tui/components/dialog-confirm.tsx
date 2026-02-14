import { createSignal, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { FG_NORMAL } from '../theme';

interface DialogConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function darkenHex(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
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
                      <text fg={btn.gradStart}>{'\uE0B6'}</text>
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
                      <text fg={btn.gradEnd}>{'\uE0B4'}</text>
                    </>
                  ) : (
                    <>
                      <text fg={dimBg}>{'\uE0B6'}</text>
                      <text fg={btn.gradStart} bg={dimBg}>
                        {btn.label}
                      </text>
                      <text fg={dimBg}>{'\uE0B4'}</text>
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
