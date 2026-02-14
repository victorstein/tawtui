import { createSignal, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import {
  ACCENT_PRIMARY,
  ACCENT_TERTIARY,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_SUCCESS,
} from '../theme';

interface SelectOption {
  label: string;
  value: string;
}

interface DialogSelectProps {
  title: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function DialogSelect(props: DialogSelectProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  useKeyboard((key) => {
    if (key.name === 'j' || key.name === 'down') {
      setSelectedIndex((prev) =>
        prev < props.options.length - 1 ? prev + 1 : prev,
      );
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      return;
    }
    if (key.name === 'return') {
      const option = props.options[selectedIndex()];
      if (option) {
        props.onSelect(option.value);
      }
      return;
    }
    if (key.name === 'escape') {
      props.onCancel();
      return;
    }
  });

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <text fg={FG_NORMAL}>{props.title}</text>
      <box height={1} />
      <For each={props.options}>
        {(option, index) => {
          const isSelected = () => selectedIndex() === index();
          return (
            <box height={1} flexDirection="row">
              <text fg={isSelected() ? ACCENT_PRIMARY : FG_MUTED}>
                {isSelected() ? '  > ' : '    '}
              </text>
              <text
                fg={isSelected() ? FG_PRIMARY : FG_DIM}
                attributes={isSelected() ? 1 : 0}
              >
                {option.label}
              </text>
            </box>
          );
        }}
      </For>
      <box height={1} />
      <box flexDirection="row">
        <text fg={COLOR_SUCCESS} attributes={1}>{' [Enter] '}</text>
        <text fg={FG_DIM}>{'Select  '}</text>
        <text fg={ACCENT_PRIMARY} attributes={1}>{' [Esc] '}</text>
        <text fg={FG_DIM}>{'Cancel'}</text>
      </box>
    </box>
  );
}
