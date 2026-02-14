import { useKeyboard } from '@opentui/solid';
import { FG_NORMAL, FG_DIM, COLOR_SUCCESS, ACCENT_PRIMARY } from '../theme';

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
      <text fg={FG_NORMAL}>{props.message}</text>
      <box height={1} />
      <box flexDirection="row">
        <text fg={COLOR_SUCCESS} attributes={1}>{' [Y] '}</text>
        <text fg={FG_DIM}>{'Yes    '}</text>
        <text fg={ACCENT_PRIMARY} attributes={1}>{' [N] '}</text>
        <text fg={FG_DIM}>{'No'}</text>
      </box>
    </box>
  );
}
