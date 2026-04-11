# Skill: Create TUI Component

Create a new @opentui/solid component following established patterns.

## File Location

For components: `src/modules/tui/components/<component-name>.tsx`

For views (full-tab content): `src/modules/tui/views/<view-name>.tsx`

Use kebab-case for the filename, PascalCase for the export.

## Template

```tsx
import { createSignal, Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import {
  BG_BASE,
  BG_SURFACE,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  ACCENT_PRIMARY,
  BORDER_DIM,
  BORDER_ACTIVE,
} from '../theme';

interface <ComponentName>Props {
  // Define props here
}

export function <ComponentName>(props: <ComponentName>Props) {
  // State
  const [selected, setSelected] = createSignal(0);

  // Keyboard handling (if interactive)
  useKeyboard((key) => {
    // Check for dialog/input capture first if needed
    if (key.name === 'j' || key.name === 'down') {
      // navigate
    }
  });

  return (
    <box flexDirection="column" width="100%">
      <text fg={FG_NORMAL}>Content here</text>
    </box>
  );
}
```

## Key Rules

1. **Theme tokens only** — Never hardcode colors. Import from `../theme`.
2. **Service access** — Import getter functions from `../bridge`:
   ```tsx
   import { getTaskwarriorService, getConfigService } from '../bridge';

   const tw = getTaskwarriorService();
   if (!tw) return;
   ```
   Never access `globalThis.__tawtui` directly.
3. **Dialog awareness** — If the component uses `useKeyboard`, check `dialog.isOpen()` first.
4. **Toast notifications** — Use the toast context for ephemeral feedback:
   ```tsx
   import { useToast } from '../context/toast';

   const toast = useToast();
   toast.show('Action completed', 'done');  // status: 'running' | 'done' | 'error'
   ```
5. **Props interface** — Always define a typed props interface.
6. **Accessor pattern** — SolidJS props are getters. Access via `props.value`, not destructuring.

## @opentui/solid Elements

| Element | Purpose |
|---|---|
| `<box>` | Layout container (flexbox) |
| `<text>` | Text display (fg, attributes, truncate) |
| `<scrollbox>` | Scrollable container |

### Box Props

- `flexDirection`, `flexGrow`, `width`, `height`
- `backgroundColor`, `borderStyle`, `borderColor`
- `paddingX`, `paddingY`, `padding`
- `position` ("absolute"), `top`, `left`, `zIndex`

### Text Props

- `fg` — Foreground color (hex string)
- `attributes` — 0=normal, 1=bold, 4=underline
- `truncate` — Boolean, truncate with ellipsis

## Reference Components

- **task-card.tsx** — Data display with colored tags, priority badges
- **board-column.tsx** — Layout container with header, separator, scrollbox
- **dialog-confirm.tsx** — Simple dialog with Yes/No
- **filter-bar.tsx** — Text input component with keyboard capture
- **tab-bar.tsx** — Horizontal tab navigation
- **terminal-output.tsx** — Embedded tmux pane display
- **oracle-setup-screen.tsx** — Multi-step wizard with progress animation
- **oracle-view.tsx** — Tab view with tmux terminal embedding and adaptive polling
