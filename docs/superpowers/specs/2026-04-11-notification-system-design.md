# Notification System Design

## Overview

A standalone macOS notification service for TaWTUI that sends native Notification Center alerts via `terminal-notifier`. Built as a self-contained building block for the upcoming Oracle feature, which will use it to surface reminders and task suggestions from Slack data when the TUI isn't foregrounded.

No current consumers — Oracle will integrate with this later.

## Constraints

- macOS only
- Bun runtime
- Must play sound on every notification
- Must bring TaWTUI's terminal to focus on notification click
- Auto-detect the running terminal app (user switches between terminals)
- Optional dependency — TaWTUI functions without it

## Architecture

New **NotificationModule** following the existing module triad pattern:

```
src/modules/
├── notification.service.ts    # Wraps terminal-notifier CLI
├── notification.module.ts     # NestJS module registration
└── notification.types.ts      # Payload types
```

### Service API

```typescript
// notification.types.ts
interface NotificationPayload {
  title: string;
  message: string;
  subtitle?: string;
  appIcon?: string; // path to icon file
}

// notification.service.ts
@Injectable()
class NotificationService {
  async send(payload: NotificationPayload): Promise<boolean>;
  async isInstalled(): Promise<boolean>;
}
```

### `send()` Behavior

Builds and executes a `terminal-notifier` command with:

- `-title` — from payload
- `-message` — from payload
- `-subtitle` — from payload (optional)
- `-appIcon` — from payload (optional)
- `-sound default` — always, every notification plays sound
- `-activate <bundleId>` — brings the terminal running TaWTUI to focus on click

Returns `true` on success, `false` on failure. Never throws.

### Terminal Auto-Detection

On service initialization, detect the running terminal via `$TERM_PROGRAM` environment variable and map it to a macOS bundle ID:

| `$TERM_PROGRAM` | Bundle ID |
|---|---|
| `Apple_Terminal` | `com.apple.Terminal` |
| `iTerm.app` | `com.googlecode.iterm2` |
| `WezTerm` | `com.github.wez.wezterm` |
| `Alacritty` | `org.alacritty` |
| `kitty` | `net.kovidgoyal.kitty` |
| `ghostty` | `com.mitchellh.ghostty` |

Cache the resolved bundle ID at startup — it won't change during a session. Fallback to `com.apple.Terminal` if `$TERM_PROGRAM` is unset or unrecognized, with a warning logged once.

## Dependency Integration

### DependencyService

- `DependencyStatus` gains a `notificationsReady: boolean` field
- `checkAll()` calls `notificationService.isInstalled()` (checks `terminal-notifier --version`)
- Does **not** affect `allGood` — notifications are optional

### Setup Wizard

- New row in the optional section: `Terminal Notifier ✓/✗`
- Install instruction: `brew install terminal-notifier`

### Homebrew Formula

- Add `terminal-notifier` to caveats as an optional prerequisite

## TUI Bridge

- Import `NotificationModule` in `TuiModule`
- Add `notificationService` to `globalThis.__tawtui` bridge object in `TuiService.launch()`
- Export `getNotificationService()` getter from `bridge.ts`

## Error Handling

| Scenario | Behavior |
|---|---|
| `terminal-notifier` not installed | `send()` returns `false` silently. Debug-level log only. |
| Terminal detection fails | Falls back to `com.apple.Terminal`. Warns once at startup. |
| Notification fails to send | Returns `false`. Fire-and-forget, never blocks or throws. |
| macOS Focus/DND suppresses sound | OS-level behavior, not handled by the service. |

## Out of Scope

- Linux/Windows support
- Notification urgency levels
- Click actions beyond bringing terminal to focus
- Notification history/persistence
- Any Oracle integration wiring
