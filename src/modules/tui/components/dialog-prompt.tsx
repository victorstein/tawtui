import { createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import {
  BG_INPUT_FOCUS,
  BG_SELECTED,
  BORDER_DIM,
  FG_NORMAL,
  FG_PRIMARY,
  COLOR_SUCCESS,
  ACCENT_PRIMARY,
} from '../theme';

interface DialogPromptProps {
  title: string;
  placeholder?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function DialogPrompt(props: DialogPromptProps) {
  const [value, setValue] = createSignal(props.initialValue ?? '');

  useKeyboard((key) => {
    if (key.name === 'escape') {
      props.onCancel();
      return;
    }
  });

  const handleSubmit = (val: string) => {
    props.onSubmit(val);
  };

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <text fg={FG_NORMAL}>{props.title}</text>
      <box height={1} />
      <input
        width="100%"
        value={value()}
        placeholder={props.placeholder ?? ''}
        focused={true}
        backgroundColor={BG_INPUT_FOCUS}
        textColor={FG_NORMAL}
        onInput={(val: string) => setValue(val)}
        onSubmit={(val: string) => handleSubmit(val)}
      />
      <box height={1} />
      <box flexDirection="row" gap={1}>
        <box
          border={true}
          borderStyle="rounded"
          borderColor={BORDER_DIM}
          backgroundColor={BG_SELECTED}
          paddingX={3}
        >
          <text fg={COLOR_SUCCESS} attributes={1}>{'Enter '}</text>
          <text fg={FG_PRIMARY}>{'Submit'}</text>
        </box>
        <box
          border={true}
          borderStyle="rounded"
          borderColor={BORDER_DIM}
          backgroundColor={BG_SELECTED}
          paddingX={3}
        >
          <text fg={ACCENT_PRIMARY} attributes={1}>{'Esc '}</text>
          <text fg={FG_PRIMARY}>{'Cancel'}</text>
        </box>
      </box>
    </box>
  );
}
