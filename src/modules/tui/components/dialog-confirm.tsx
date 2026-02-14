import { useKeyboard } from '@opentui/solid';

interface DialogConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DialogConfirm(props: DialogConfirmProps) {
  useKeyboard((key) => {
    if (key.name === 'y') {
      props.onConfirm();
      return;
    }
    if (key.name === 'n') {
      props.onCancel();
      return;
    }
  });

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <text fg="#ccccdd">{props.message}</text>
      <box height={1} />
      <box flexDirection="row">
        <text fg="#88cc88" attributes={1}>{' [Y] '}</text>
        <text fg="#aaaaaa">{'Yes    '}</text>
        <text fg="#cc8888" attributes={1}>{' [N] '}</text>
        <text fg="#aaaaaa">{'No'}</text>
      </box>
    </box>
  );
}
