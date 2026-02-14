import { createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';

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
      <text fg="#ccccdd">{props.title}</text>
      <box height={1} />
      <input
        width="100%"
        value={value()}
        placeholder={props.placeholder ?? ''}
        focused={true}
        backgroundColor="#2a2a3e"
        textColor="#ddddee"
        onInput={(val: string) => setValue(val)}
        onSubmit={(val: string) => handleSubmit(val)}
      />
      <box height={1} />
      <box flexDirection="row">
        <text fg="#88aacc" attributes={1}>{' [Enter] '}</text>
        <text fg="#aaaaaa">{'Submit  '}</text>
        <text fg="#cc8888" attributes={1}>{' [Esc] '}</text>
        <text fg="#aaaaaa">{'Cancel'}</text>
      </box>
    </box>
  );
}
