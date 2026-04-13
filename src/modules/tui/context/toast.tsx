import {
  createContext,
  useContext,
  createSignal,
  For,
  Show,
  onCleanup,
  type JSX,
  type ParentProps,
} from 'solid-js';
import { P, COLOR_SUCCESS, COLOR_ERROR, FG_NORMAL, BG_SURFACE, BORDER_DIALOG } from '../theme';
import { useSpinner } from '../utils';

interface Toast {
  id: number;
  message: string;
  status: 'running' | 'done' | 'error';
}

interface ToastContextValue {
  /** Show a toast. Returns its id for later update/dismiss. */
  show(message: string, status?: Toast['status']): number;
  /** Update an existing toast's message and/or status. */
  update(id: number, message: string, status?: Toast['status']): void;
  /** Dismiss a toast immediately. */
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue>();

const DISMISS_MS = 3000;
let nextId = 1;

const STATUS_ICON: Record<Toast['status'], string> = {
  running: '⟳',
  done: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<Toast['status'], string> = {
  running: P.purple,
  done: COLOR_SUCCESS,
  error: COLOR_ERROR,
};

export function ToastProvider(props: ParentProps): JSX.Element {
  const spinnerFrame = useSpinner();
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });

  function scheduleDismiss(id: number): void {
    if (timers.has(id)) clearTimeout(timers.get(id)!);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, DISMISS_MS),
    );
  }

  const ctx: ToastContextValue = {
    show(message, status = 'running') {
      const id = nextId++;
      setToasts((prev) => [{ id, message, status }, ...prev]);
      if (status !== 'running') scheduleDismiss(id);
      return id;
    },
    update(id, message, status = 'running') {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, message, status } : t)),
      );
      if (status !== 'running') {
        scheduleDismiss(id);
      } else if (timers.has(id)) {
        clearTimeout(timers.get(id)!);
        timers.delete(id);
      }
    },
    dismiss(id) {
      if (timers.has(id)) {
        clearTimeout(timers.get(id)!);
        timers.delete(id);
      }
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
  };

  return (
    <ToastContext.Provider value={ctx}>
      <box flexDirection="column" width="100%" height="100%">
        <box flexGrow={1} position="relative">
          {props.children}
          <Show when={toasts().length > 0}>
            <box
              position="absolute"
              top={0}
              right={1}
              flexDirection="column"
              gap={0}
            >
              <For each={toasts()}>
                {(toast) => (
                  <box
                    flexDirection="row"
                    backgroundColor={BG_SURFACE}
                    borderStyle="rounded"
                    borderColor={STATUS_COLOR[toast.status]}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={STATUS_COLOR[toast.status]}>
                      {`${toast.status === 'running' ? spinnerFrame() : STATUS_ICON[toast.status]} `}
                    </text>
                    <text fg={FG_NORMAL}>{toast.message}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
