# TUI Layer

## Framework

Built on **@opentui/solid** (terminal UI) + **Solid.js** (reactivity). Components use JSX with terminal primitives: `<box>`, `<text>`, `<input>`, `<scrollbox>`.

## Core Hooks

| Hook | Purpose |
|---|---|
| `useKeyboard(handler)` | Register key handler. **Only one per component** — multiple calls silently override. |
| `useTerminalDimensions()` | Returns `{ width, height }` signals for responsive layout. |
| `usePaste(handler)` | Handle clipboard paste events. |
| `useRenderer()` | Access renderer for `requestFullRender()` (force repaint). |

All imported from `@opentui/solid`. Types like `ScrollBoxRenderable`, `RGBA`, `SyntaxStyle` from `@opentui/core`.

## Bridge Access

Components access NestJS services via `globalThis.__tawtui`. Use typed getters from `bridge.ts`:

```typescript
import { getTaskwarriorService, getGithubService } from '../bridge';

const taskService = getTaskwarriorService(); // returns service or null
```

Always null-check — bridge may not be initialized yet on first render.

## Theme System

Defined in `theme.ts`. **Read `.claude/docs/tui-design-reference.md` before building any component** — it covers semantic tokens, gradient patterns, button styles, border conventions, powerline caps, and selection/focus patterns.

Key rules:
- Use semantic tokens only (never raw hex colors)
- 6 gradient pairs available for headers/accents
- Powerline characters (``, ``) for visual polish
- Dynamic colors generated from string hashes for consistent per-item coloring

## Component Patterns

- Props + Solid.js signals (`createSignal`, `createMemo`, `createEffect`)
- Keyboard handler via `useKeyboard` — bind keys, handle focus state
- Data fetching in `createEffect` or on mount — call bridge services
- `refreshTrigger` signal pattern: increment a counter to force data reload

## View Patterns

- Each view is a tab (Tasks, Reviews, Calendar, Oracle)
- Tab switching via number keys (1-4) in `app.tsx`
- Views manage their own state, keyboard handlers, and layout
- Views access services through bridge getters

## Dialog Context (`context/dialog.tsx`)

Stack-based dialog system:
- `pushDialog(component)` / `popDialog()` for layered dialogs
- `showConfirm()`, `showPrompt()`, `showSelect()` convenience methods
- **Dialogs do NOT auto-block parent keyboard input** — parent must check dialog state before handling keys

## Toast Context (`context/toast.tsx`)

Notification toasts with auto-dismiss:
- `showToast(message, opts)` / `updateToast(id, opts)` / `dismissToast(id)`
- Used for sync progress, error feedback, status updates

## Keyboard Conventions

- **Vim-like navigation**: j/k (up/down), h/l (left/right)
- **Tab keys**: 1-4 for tabs
- **Actions**: Enter (select), q/Ctrl+C (quit), Shift+S (sync)
- **Dialogs**: single-char shortcuts (y/n for confirm, etc.)

## ScrollBox Pattern

`<scrollbox>` requires:
- Fixed parent height (won't work with auto-sizing)
- `ScrollBoxRenderable` items with `render()` method returning styled text
- Content is an array of renderables, not JSX children

## Gotchas

- **One `useKeyboard` per component** — second call silently overrides the first. Combine all key logic into one handler.
- **Dialogs don't block parent input** — if a dialog is open, the parent view's keyboard handler still fires. Check `dialogStack.length > 0` before handling keys.
- **ScrollBox needs fixed height** — parent must provide explicit dimensions, not rely on flex/auto.
- **Services return null** — always check return value from bridge getters before calling methods.
- **ANSI parsing is expensive** — memoize parsed terminal output, don't re-parse on every render.
- **`createSignal` vs `createMemo`** — signals don't re-read during render. Use `createMemo` for derived values that depend on other signals.
- **Archive is a sub-view, not a tab** — it renders inside TasksView, not as a separate tab.
- **Interactive mode (terminal output view) disables tab routing** — keyboard events go to the terminal, not the TUI.
