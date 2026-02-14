import {
  createContext,
  useContext,
  createSignal,
  Show,
  type JSX,
  type ParentProps,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { RGBA } from '@opentui/core';
import { BG_SURFACE, BORDER_DIALOG } from '../theme';

export type DialogSize = 'small' | 'medium' | 'large';

export interface DialogOptions {
  size?: DialogSize;
  onClose?: () => void;
}

interface DialogEntry {
  content: () => JSX.Element;
  options: DialogOptions;
}

interface DialogContextValue {
  show: (content: () => JSX.Element, opts?: DialogOptions) => void;
  close: () => void;
  isOpen: () => boolean;
}

const DialogContext = createContext<DialogContextValue>();

const DIALOG_WIDTHS: Record<DialogSize, number> = {
  small: 40,
  medium: 60,
  large: 80,
};

const DIALOG_HEIGHT_RATIO: Record<DialogSize, number> = {
  small: 0.3,
  medium: 0.5,
  large: 0.8,
};

export function DialogProvider(props: ParentProps) {
  const [stack, setStack] = createSignal<DialogEntry[]>([]);
  const dims = useTerminalDimensions();

  const isOpen = () => stack().length > 0;

  const show = (content: () => JSX.Element, opts?: DialogOptions) => {
    setStack((prev) => [...prev, { content, options: opts ?? {} }]);
  };

  const close = () => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const top = prev[prev.length - 1];
      top.options.onClose?.();
      return prev.slice(0, -1);
    });
  };

  useKeyboard((key) => {
    if (!isOpen()) return;
    if (key.name === 'escape') {
      close();
    }
  });

  const topEntry = () => {
    const s = stack();
    return s.length > 0 ? s[s.length - 1] : undefined;
  };

  const dialogWidth = () => {
    const entry = topEntry();
    const size = entry?.options.size ?? 'medium';
    const desired = DIALOG_WIDTHS[size];
    const termWidth = dims().width;
    return Math.min(desired, termWidth - 4);
  };

  const dialogHeight = () => {
    const entry = topEntry();
    const size = entry?.options.size ?? 'medium';
    const ratio = DIALOG_HEIGHT_RATIO[size];
    const termHeight = dims().height;
    return Math.min(Math.floor(termHeight * ratio), termHeight - 4);
  };

  const dialogLeft = () => {
    const termWidth = dims().width;
    return Math.max(0, Math.floor((termWidth - dialogWidth()) / 2));
  };

  const dialogTop = () => {
    const termHeight = dims().height;
    return Math.max(1, Math.floor((termHeight - dialogHeight()) / 2));
  };

  const contextValue: DialogContextValue = {
    show,
    close,
    isOpen,
  };

  return (
    <DialogContext.Provider value={contextValue}>
      {props.children}
      <Show when={isOpen()}>
        {/* Backdrop overlay */}
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
          zIndex={100}
        />
        {/* Dialog box */}
        <Show when={topEntry()}>
          {(entry) => (
            <box
              position="absolute"
              top={dialogTop()}
              left={dialogLeft()}
              width={dialogWidth()}
              maxHeight={dialogHeight()}
              flexDirection="column"
              backgroundColor={BG_SURFACE}
              borderStyle="rounded"
              borderColor={BORDER_DIALOG}
              zIndex={101}
            >
              {entry().content()}
            </box>
          )}
        </Show>
      </Show>
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return ctx;
}
