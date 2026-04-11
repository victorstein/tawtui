# Oracle System Notifications Design

> Fire native macOS notifications when the oracle finds action items and the user is not on the Oracle tab. Complements the existing in-app toast.

## Problem

When the oracle finds commitments in Slack conversations, the user only sees a toast inside tawtui. If they're in another app (browser, IDE, Slack itself), they miss it entirely until they switch back.

## Solution

Extend the existing oracle alert detection loop in `app.tsx` to also fire a system notification via `NotificationService.send()`. The notification includes channel names from the last sync for context.

## Notification Tiers

| User location | Toast | System notification |
|---|---|---|
| Oracle tab | No (they see it live) | No |
| Other tawtui tab | Yes | Yes |
| Different app entirely | Yes (seen on return) | Yes |

The system notification fires whenever the user is not on the Oracle tab. macOS handles deduplication — if the terminal is focused, the notification appears as a banner; if not, it goes to Notification Center.

## Notification Content

```
Title: "TaWTUI Oracle"
Message: "New action items from #backend, #deploys"
```

Channel names come from the last sync-complete event's `channelNames` array, tracked via a SolidJS signal. Falls back to "New action items found" if no channel context is available.

## Implementation

### Last Sync Context

A new `lastSyncChannels` signal in `app.tsx` stores the channel names from the most recent `onIngestComplete` callback:

```typescript
const [lastSyncChannels, setLastSyncChannels] = createSignal<string[]>([]);

svc.onIngestComplete = (result) => {
  if (result.channelNames.length > 0) {
    setLastSyncChannels(result.channelNames);
  }
  // ... existing toast logic
};
```

### Alert Detection Extension

The existing oracle alert detection interval (2-second poll of tmux capture for `[ORACLE ALERT]`) gains one addition — after showing the toast, fire the system notification:

```typescript
const notificationService = getNotificationService();
if (notificationService) {
  const channels = lastSyncChannels();
  const message = channels.length > 0
    ? `New action items from ${channels.join(', ')}`
    : 'New action items found';
  void notificationService.send({
    title: 'TaWTUI Oracle',
    message,
  });
}
```

This runs inside the same `if (alertHash !== lastOracleAlertHash)` guard, so it only fires once per new alert — same deduplication as the toast.

## What Changes

- `src/modules/tui/app.tsx` — Add `lastSyncChannels` signal, set from `onIngestComplete`, fire `notificationService.send()` in alert detection loop

## What Does NOT Change

- NotificationService — already wired up from main merge
- Bridge — `getNotificationService()` already available
- Oracle channel events — unchanged
- Toast behavior — unchanged (still fires alongside notification)
- Oracle prompt — unchanged
