# TUI Design Reference

The Tasks tab is the canonical reference for visual patterns. All new components must follow these conventions.

---

## Theme System (`src/modules/tui/theme.ts`)

### Core Palette (`P`)

```
Backgrounds:    bg=#0a2131  bgLight=#0e2a3d  bgLighter=#133347
Surfaces:       surface=#1a5764  border=#1a4050
Accents:        primary=#fc6529(orange)  secondary=#445f80  secondaryLight=#6a88a8  tertiary=#2a7a8a
Warm tones:     cream=#dcca99  tan=#c8a070  amber=#d4a74a
Text:           white=#ffffff  offWhite=#e8e4dc  gray=#c0bab0  grayBlue=#8a9098  grayDark=#5a6a75
Status:         red=#e05555  green=#5aaa6a  tealGreen=#2a8a7a  tealBright=#5aaaa0  purple=#8a7aaa
```

### Semantic Tokens (always use these, never raw `P` values in components)

| Token | Value | Use |
|---|---|---|
| `BG_BASE` | `P.bg` | Deepest background |
| `BG_SURFACE` | `P.bgLight` | Panel/surface background |
| `BG_SELECTED` | `P.bgLighter` | Selected/focused row highlight |
| `BG_INPUT` | `P.bgLight` | Input field default |
| `BG_INPUT_FOCUS` | `P.bgLighter` | Input field focused |
| `BORDER_DIM` | `P.border` | Inactive borders |
| `BORDER_ACTIVE` | `P.primary` | Active/focused borders |
| `BORDER_DIALOG` | `P.surface` | Dialog borders |
| `FG_PRIMARY` | `P.white` | Highest-contrast text (titles, selected items) |
| `FG_NORMAL` | `P.offWhite` | Default body text |
| `FG_DIM` | `P.gray` | Secondary text, labels |
| `FG_MUTED` | `P.grayBlue` | Hint text |
| `FG_FAINT` | `P.grayDark` | Lowest-contrast text |
| `ACCENT_PRIMARY` | `P.primary` | Orange — active elements, key hints |
| `ACCENT_SECONDARY` | `P.secondaryLight` | Slate blue — highlights |
| `ACCENT_TERTIARY` | `P.tertiary` | Teal — secondary key hints |
| `COLOR_ERROR` | `P.red` | Errors, overdue, blocked |
| `COLOR_SUCCESS` | `P.green` | Success, Enter key hints |
| `COLOR_WARNING` | `P.amber` | Warnings |
| `PRIORITY_H/M/L` | `red/orange/green` | Task priority badges |
| `SEPARATOR_COLOR` | `P.border` | Horizontal separators |
| `TAG_COLORS` | `[8 colors]` | Stable color assignment via djb2 hash |
| `PROJECT_COLOR` | `P.tealGreen` | Project pill background |

---

## Gradient Pattern

Used in: column headers, tab bar, buttons, separators.

### Implementation

Two utility functions duplicated across components (available for extraction):

```tsx
function lerpHex(a: string, b: string, t: number): string { ... }
function darkenHex(hex: string, factor: number): string { ... }
```

### How Gradients Work

Gradients are per-character — each character in a label gets an interpolated `bg` (or `fg` for separators):

```tsx
<For each={label.split('')}>
  {(char, i) => {
    const t = label.length > 1 ? i() / (label.length - 1) : 0;
    return <text fg="#ffffff" bg={lerpHex(gradStart, gradEnd, t)} attributes={1}>{char}</text>;
  }}
</For>
```

### Column Header Gradients

```
TODO:          #8a7aaa → #445f80  (purple → slate)
IN PROGRESS:   #fc6529 → #d43535  (orange → red)
DONE:          #5aaa6a → #2a7a8a  (green → teal)
```

Inactive columns: `darkenHex(color, 0.5)` dims both start and end.

### Tab Bar Gradients

Active tabs: `ACCENT_PRIMARY (#fc6529)` → `#d43535` (orange→red)
Inactive tabs: `BORDER_DIM (#1a4050)` → `#0e2a3d` (dark teal→navy)

### Gradient Separators

Full-width horizontal lines using `─` (U+2500) with per-character gradient `fg`:

```tsx
<box height={1} width="100%" flexDirection="row">
  <For each={Array.from({ length: innerWidth }, (_, i) => i)}>
    {(i) => <text fg={lerpHex(colorStart, colorEnd, t)}>{'\u2500'}</text>}
  </For>
</box>
```

---

## Powerline Caps Pattern

Used in: tab bar, column headers, tag pills, buttons.

- Left cap: `\uE0B6` (right-facing half-circle)
- Right cap: `\uE0B4` (left-facing half-circle)

### Pill with gradient fill (column header, tab, focused button)

```tsx
<text fg={gradStart}>{LEFT_CAP}</text>
<For each={label.split('')}>
  {(char, i) => <text fg="#fff" bg={lerpHex(gradStart, gradEnd, t)} attributes={1}>{char}</text>}
</For>
<text fg={gradEnd}>{RIGHT_CAP}</text>
```

### Pill with flat fill (tag pill)

```tsx
<text fg={bgColor}>{'\uE0B6'}</text>
<box backgroundColor={bgColor}><text fg={fgColor}>{' tag '}</text></box>
<text fg={bgColor}>{'\uE0B4'}</text>
```

---

## Button Pattern

### Gradient Button (focused) — from `dialog-confirm.tsx`

Each button has `gradStart` and `gradEnd` colors. When focused, renders per-character gradient:

```tsx
// Focused
<text fg={gradStart}>{LEFT_CAP}</text>
<For each={chars}>
  {(char, i) => <text fg="#fff" bg={lerpHex(gradStart, gradEnd, t)} attributes={1}>{char}</text>}
</For>
<text fg={gradEnd}>{RIGHT_CAP}</text>

// Unfocused — flat dimmed background
const dimBg = darkenHex(gradStart, 0.3);
<text fg={dimBg}>{LEFT_CAP}</text>
<text fg={gradStart} bg={dimBg}>{label}</text>
<text fg={dimBg}>{RIGHT_CAP}</text>
```

### Button color pairs (used in DialogConfirm)

```
Yes: gradStart=#5aaa6a  gradEnd=#2a7a8a  (green → teal)
No:  gradStart=#e05555  gradEnd=#8a2a2a  (red → dark red)
```

### Bordered Button (DialogPrompt, DialogSelect)

```tsx
<box border={true} borderStyle="rounded" borderColor={BORDER_DIM} backgroundColor={BG_SELECTED} paddingX={3}>
  <text fg={COLOR_SUCCESS} attributes={1}>{'Enter '}</text>
  <text fg={FG_PRIMARY}>{'Submit'}</text>
</box>
```

---

## Border Pattern

| Element | Style | Color |
|---|---|---|
| Board columns | `borderStyle="single"` | Active: `lerpHex(gradStart, gradEnd, 0.5)`, inactive: `BORDER_DIM` |
| Dialogs | `borderStyle="rounded"` | `BORDER_DIALOG` (P.surface) |
| Suggestions popup | `borderStyle="single"` | `BORDER_DIM` |
| Bordered buttons | `borderStyle="rounded"` | `BORDER_DIM` |

---

## Key Hint Pattern

Key hints use colored brackets with dim labels. Consistent across filter bar, task form:

```tsx
<text fg={ACCENT_TERTIARY} attributes={1}>{' [Tab] '}</text>
<text fg={FG_DIM}>{'Next field  '}</text>
<text fg={COLOR_SUCCESS} attributes={1}>{' [Enter] '}</text>
<text fg={FG_DIM}>{'Save  '}</text>
<text fg={ACCENT_PRIMARY} attributes={1}>{' [Esc] '}</text>
<text fg={FG_DIM}>{'Cancel'}</text>
```

Color assignments for key hints:
- **Enter/Submit/Apply** → `COLOR_SUCCESS` (green)
- **Esc/Cancel** → `ACCENT_PRIMARY` (orange)
- **Tab/Navigation** → `ACCENT_TERTIARY` (teal)
- **Label text** → `FG_DIM`

---

## Selection/Focus Pattern

- Selected row: `backgroundColor={BG_SELECTED}`, text `fg={FG_PRIMARY}`, `attributes={1}` (bold)
- Unselected row: no bg, text `fg={FG_DIM}`, `attributes={0}`
- Active column border: mid-gradient color; inactive: `BORDER_DIM`
- Cursor indicator: `> ` prefix on selected items (DialogSelect, TaskForm)

---

## Dialog System

From `context/dialog.tsx`:

- Three sizes: `small` (40w, 30%h), `medium` (60w, 50%h), `large` (80w, 80%h)
- Backdrop: `RGBA.fromInts(0, 0, 0, 150)` absolute overlay
- Dialog box: `BG_SURFACE` bg, `borderStyle="rounded"`, `borderColor={BORDER_DIALOG}`
- Position: centered via dimension math
- Stack-based: supports nested dialogs
- Escape closes topmost dialog

---

## Task Card Layout

Three-line card layout (lines 2-3 conditional):

1. **Priority pill + Description**: `[HIGH]` pill with `backgroundColor={priorityColor}` + description text
2. **Project (rectangular) + Tags (rounded caps)**: project uses flat bg, tags use powerline caps with `darkenHex(bright, 0.35)` bg
3. **Due date + BLOCKED indicator**: dim label, overdue in red

---

## Status Bar

Single-line at bottom, `height={1}`, `fg={FG_DIM}`, context-sensitive key hints.

---

## Component Architecture

- **Framework**: Solid.js with `@opentui/solid` for TUI primitives
- **Primitives**: `<box>`, `<text>`, `<input>`, `<scrollbox>` from @opentui/solid
- **Keyboard**: `useKeyboard((key) => { ... })` hook — check `key.name`, `key.shift`, `key.ctrl`
- **Dimensions**: `useTerminalDimensions()` returns `{ width, height }`
- **Signals**: Solid.js `createSignal`, `createEffect`, `Show`, `For`, `Switch/Match`
- **Service access**: `(globalThis as any).__tawtui?.serviceName`

---

## Rules for New Components

1. **Always use semantic tokens** — never reference `P` directly in components
2. **Gradients** — use `lerpHex()` for per-character gradient fills
3. **Dimming** — use `darkenHex(color, factor)` for inactive/unfocused states
4. **Powerline caps** — `\uE0B6` (left) and `\uE0B4` (right) for pills/badges
5. **Buttons** — gradient fill when focused, dimmed flat fill when unfocused
6. **Borders** — `single` for structural, `rounded` for dialogs/buttons
7. **Text hierarchy** — `FG_PRIMARY` > `FG_NORMAL` > `FG_DIM` > `FG_MUTED` > `FG_FAINT`
8. **Key hints** — green=Enter, orange=Esc, teal=Tab/nav, dim=labels
9. **Selection** — `BG_SELECTED` bg + `FG_PRIMARY` + bold
10. **Transparent backgrounds** — base backgrounds are transparent (not set), only surfaces/selections have explicit bg
