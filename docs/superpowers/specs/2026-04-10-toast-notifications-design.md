# Toast Notifications for Oracle Operations

## Problem

Sync (Shift+S) and re-check (r) operations in the Oracle tab execute silently. The status bar shows a small `⟳ syncing` indicator during ingestion, but it's easy to miss. Re-check has zero visual feedback. Users can't tell if their action worked.

## Solution

A shared toast notification system rendered as a top-right overlay. Toasts show operation progress and results, then auto-dismiss.

## Design

### Toast Context (shared, App-level)

New file: `src/modules/tui/context/toast.tsx`

Follows the existing `DialogContext` pattern. Provides a `ToastProvider` component and `useToast()` hook.

```typescript
interface Toast {
  id: number;
  message: string;
  status: 'running' | 'done' | 'error';
}

interface ToastContext {
  show(message: string, status?: 'running' | 'done' | 'error'): number;
  update(id: number, message: string, status?: 'running' | 'done' | 'error'): void;
  dismiss(id: number): void;
}
```

**Lifecycle rules:**
- `running` toasts persist until updated or dismissed
- `done` and `error` toasts auto-dismiss after 3 seconds
- Multiple toasts stack vertically (newest on top)

**Default icons by status:**
- `running` → `⟳`
- `done` → `✓`
- `error` → `✗`

### Rendering

The `ToastProvider` wraps the view content area in App.tsx (inside the existing layout, below the tab bar). The toast container is an absolutely-positioned box in the top-right corner overlaying the view content.

Each toast is a single-line element: `icon + message`. Colors follow the theme:
- `running` → oracle purple (`P.purple`)
- `done` → `COLOR_SUCCESS`
- `error` → `COLOR_ERROR`

### Integration Points

#### 1. Re-check (`r` key — OracleView)

```
Press 'r'
  → toast.show('Checking dependencies...', 'running')
  → await checkDependencies()
  → if all good: toast.update(id, 'All good', 'done')
  → if missing:  toast.update(id, 'Missing: <dep>', 'error')
```

Auto-dismisses after 3 seconds.

#### 2. Sync (`Shift+S` — App.tsx)

```
Press 'S'
  → toast.show('Syncing...', 'running')
  → result = await svc.triggerIngest()
  → toast.update(id, 'Synced N messages', 'done')
```

Currently `triggerIngest()` is called with `void` (fire-and-forget). Change to `await` the result so we can read `messagesStored` for the completion message.

#### 3. Blocked sync (`Shift+S` while already syncing — App.tsx)

```
Press 'S' while ingesting
  → toast.show('Already syncing', 'error')
```

### Files to Create/Modify

| File | Change |
|---|---|
| `src/modules/tui/context/toast.tsx` | **New** — ToastProvider, useToast, toast rendering |
| `src/modules/tui/app.tsx` | Wrap views in ToastProvider, wire sync toast |
| `src/modules/tui/views/oracle-view.tsx` | Wire re-check toast |

### No Backend Changes

All changes are UI-only. The existing `triggerIngest()` already returns `{ messagesStored }` — we just need to stop discarding the result.
