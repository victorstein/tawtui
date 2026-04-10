# Toast Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared toast notification system that provides visual feedback for sync, re-check, and blocked actions in the Oracle tab.

**Architecture:** A `ToastProvider` context (following the existing `DialogProvider` pattern) wraps the view content area in App.tsx. Views call `useToast()` to show/update/dismiss toasts. Toasts render as an absolutely-positioned overlay in the top-right corner. Running toasts persist; done/error toasts auto-dismiss after 3 seconds.

**Tech Stack:** Solid.js (createContext, createSignal, Show, For), @opentui/solid (useTerminalDimensions), existing theme tokens.

**Spec:** `docs/superpowers/specs/2026-04-10-toast-notifications-design.md`

---

### Task 1: Create ToastContext

**Files:**
- Create: `src/modules/tui/context/toast.tsx`

- [ ] **Step 1: Create the toast context file with types and provider**

```typescript
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
import { P, COLOR_SUCCESS, COLOR_ERROR, FG_NORMAL } from '../theme';

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
                  <box flexDirection="row">
                    <text fg={STATUS_COLOR[toast.status]}>
                      {`${STATUS_ICON[toast.status]} `}
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
```

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/tui/context/toast.tsx
git commit -m "feat(tui): add ToastContext with show/update/dismiss API"
```

---

### Task 2: Wire ToastProvider into App layout

**Files:**
- Modify: `src/modules/tui/app.tsx`

- [ ] **Step 1: Add ToastProvider import**

Add to the imports:
```typescript
import { ToastProvider, useToast } from './context/toast';
```

- [ ] **Step 2: Wrap the App component with ToastProvider**

Change the `App` export to wrap with `ToastProvider`, similar to how `DialogProvider` wraps:

```typescript
export function App() {
  return (
    <DialogProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </DialogProvider>
  );
}
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/tui/app.tsx
git commit -m "feat(tui): wire ToastProvider into App layout"
```

---

### Task 3: Wire sync toast (Shift+S)

**Files:**
- Modify: `src/modules/tui/app.tsx`

- [ ] **Step 1: Add toast to the Shift+S handler**

In `AppContent`, get the toast context:
```typescript
const toast = useToast();
```

Replace the current Shift+S handler (which uses `void svc.triggerIngest()`):

```typescript
// Manual Slack sync
if (key.name === 'S' && !key.ctrl && !key.meta) {
  if (!oracleReady()) return;
  if (ingesting()) {
    toast.show('Already syncing', 'error');
    return;
  }
  const svc = getSlackIngestionService();
  if (!svc) return;
  const id = toast.show('Syncing...');
  svc.triggerIngest().then(
    (result) => {
      const count = result.messagesStored;
      toast.update(
        id,
        count > 0 ? `Synced ${count} messages` : 'No new messages',
        'done',
      );
    },
    () => {
      toast.update(id, 'Sync failed', 'error');
    },
  );
  return;
}
```

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/tui/app.tsx
git commit -m "feat(tui): wire sync toast with progress and result feedback"
```

---

### Task 4: Wire re-check toast (r key)

**Files:**
- Modify: `src/modules/tui/views/oracle-view.tsx`

- [ ] **Step 1: Import useToast**

Add to the imports:
```typescript
import { useToast } from '../context/toast';
```

- [ ] **Step 2: Get toast context in OracleView**

Near the top of the `OracleView` function, alongside the existing `useDialog()`:
```typescript
const toast = useToast();
```

- [ ] **Step 3: Update the 'r' key handler in the oracleReady section**

Find the re-check handler (currently `void checkDependencies()`) in the `oracleReady()` block and replace:

```typescript
// [r] Recheck dependencies
if (key.name === 'r' && !key.shift) {
  void checkDependencies();
  detectExistingSession();
  return;
}
```

With:

```typescript
// [r] Recheck dependencies
if (key.name === 'r' && !key.shift) {
  const id = toast.show('Checking dependencies...');
  checkDependencies().then(
    () => {
      const status = depStatus();
      if (status?.oracleReady) {
        toast.update(id, 'All good', 'done');
      } else if (status?.oracleInitialized === false) {
        toast.update(id, 'Oracle not initialized', 'error');
      } else {
        toast.update(id, 'Dependencies checked', 'done');
      }
    },
    () => {
      toast.update(id, 'Check failed', 'error');
    },
  );
  detectExistingSession();
  return;
}
```

Also update the same handler in the setup mode block (the `!oracleReady()` section) to use the toast:

```typescript
if (key.name === 'r') {
  const id = toast.show('Checking dependencies...');
  checkDependencies().then(
    () => toast.update(id, 'Dependencies checked', 'done'),
    () => toast.update(id, 'Check failed', 'error'),
  );
  return;
}
```

- [ ] **Step 4: Verify build passes**

Run: `bun run build`
Expected: No errors

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: All 77 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/modules/tui/views/oracle-view.tsx
git commit -m "feat(tui): wire re-check toast with dependency status feedback"
```

---

### Task 5: Manual QA

- [ ] **Step 1: Start the dev server**

Run: `bun run start:dev`

- [ ] **Step 2: Test sync toast**

Navigate to Oracle tab. Press `Shift+S`.
Expected: Toast appears top-right: "⟳ Syncing..." → updates to "✓ Synced N messages" or "✓ No new messages" → auto-dismisses after 3s.

- [ ] **Step 3: Test blocked sync toast**

While sync is running, press `Shift+S` again.
Expected: Toast appears: "✗ Already syncing" → auto-dismisses after 3s.

- [ ] **Step 4: Test re-check toast**

Press `r` in the Oracle tab.
Expected: Toast appears: "⟳ Checking dependencies..." → updates to "✓ All good" → auto-dismisses after 3s.

- [ ] **Step 5: Test re-check in setup mode**

If setup screen is visible, press `r`.
Expected: Toast appears: "⟳ Checking dependencies..." → updates to "✓ Dependencies checked" → auto-dismisses.

- [ ] **Step 6: Test toast stacking**

Trigger re-check (`r`) and immediately sync (`Shift+S`).
Expected: Both toasts appear, stacked vertically. Each auto-dismisses independently.
