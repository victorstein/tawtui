import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { CalendarEvent } from '../../calendar.types';
import type { CreateTaskDto } from '../../taskwarrior.types';
import type { DependencyStatus } from '../../dependency.types';
import { EventCard } from '../components/event-card';
import { DialogEventToTask } from '../components/dialog-event-to-task';
import { DialogSetupWizard } from '../components/dialog-setup-wizard';
import { DialogGogAuth } from '../components/dialog-gog-auth';
import { useDialog } from '../context/dialog';
import {
  getCalendarService,
  getTaskwarriorService,
  getConfigService,
  getDependencyService,
} from '../bridge';
import {
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_ERROR,
  COLOR_SUCCESS,
  CALENDAR_GRAD,
} from '../theme';
import { lerpHex, LEFT_CAP, RIGHT_CAP } from '../utils';

interface CalendarViewProps {
  refreshTrigger?: () => number;
  onNavigateToTask?: (taskUuid: string) => void;
}

function formatDateHeader(d: Date): string {
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatDateShort(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + n);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toISODateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarView(props: CalendarViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  const [selectedDate, setSelectedDate] = createSignal<Date>(new Date());
  const [events, setEvents] = createSignal<CalendarEvent[]>([]);
  const [eventIndex, setEventIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [linkedEventMap, setLinkedEventMap] = createSignal<Map<string, string>>(
    new Map(),
  );
  const [statusMsg, setStatusMsg] = createSignal('');
  const [statusIsError, setStatusIsError] = createSignal(false);

  const isAuthError = () => {
    const e = error();
    return e !== null && (e.includes('invalid_grant') || e.includes('Token has been expired') || e.includes('insufficientPermissions'));
  };

  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  function showStatus(msg: string, isError = false): void {
    if (statusTimer) clearTimeout(statusTimer);
    setStatusMsg(msg);
    setStatusIsError(isError);
    statusTimer = setTimeout(() => {
      setStatusMsg('');
      setStatusIsError(false);
    }, 3000);
  }

  onCleanup(() => {
    if (statusTimer) clearTimeout(statusTimer);
  });

  function loadLinkedEventIds(): void {
    const tw = getTaskwarriorService();
    if (!tw) return;
    try {
      setLinkedEventMap(tw.getLinkedCalendarEventMap());
    } catch {
      // Non-fatal — linked status is a nice-to-have
    }
  }

  async function loadEvents(date: Date): Promise<void> {
    const cal = getCalendarService();
    if (!cal) {
      setError('CalendarService not available');
      return;
    }

    const config = getConfigService();
    const calendarId =
      config?.getCalendarConfig().defaultCalendarId ?? 'primary';
    const dateStr = toISODateString(date);

    setLoading(true);
    setError(null);
    try {
      const result = await cal.getEvents({
        calendarId,
        from: dateStr,
        to: toISODateString(addDays(date, 1)),
      });
      // Filter to only events starting on the selected date
      const filtered = result.filter((e) => {
        if (e.start.dateTime) {
          return e.start.dateTime.startsWith(dateStr);
        }
        if (e.start.date) {
          return e.start.date === dateStr;
        }
        return false;
      });
      filtered.sort((a, b) => {
        const aTime = a.start.dateTime ?? a.start.date ?? '';
        const bTime = b.start.dateTime ?? b.start.date ?? '';
        return aTime.localeCompare(bTime);
      });
      // Deduplicate by event id (shared calendar overlaps)
      const seen = new Set<string>();
      const unique = filtered.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      setEvents(unique);
      if (eventIndex() >= unique.length) {
        setEventIndex(Math.max(unique.length - 1, 0));
      }
      loadLinkedEventIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadEvents(selectedDate());
  });

  // Reload when selected date changes
  createEffect(
    on(
      selectedDate,
      (date) => {
        loadEvents(date);
      },
      { defer: true },
    ),
  );

  // Reload when parent bumps refreshTrigger
  createEffect(
    on(
      () => props.refreshTrigger?.(),
      () => {
        loadEvents(selectedDate());
      },
      { defer: true },
    ),
  );

  // Pane widths
  const navPaneWidth = () => Math.floor(dimensions().width * 0.25);
  const eventPaneWidth = () => dimensions().width - navPaneWidth();

  const innerNavWidth = () => Math.max(navPaneWidth() - 2, 1);
  const navHeaderLabel = () => ` ${formatDateShort(selectedDate())} `;
  const innerEventWidth = () => Math.max(eventPaneWidth() - 2, 1);
  const eventHeaderLabel = () => ` EVENTS (${events().length}) `;

  function openConvertDialog(event: CalendarEvent): void {
    dialog.show(
      () => (
        <DialogEventToTask
          event={event}
          onConfirm={(dto: CreateTaskDto) => {
            const tw = getTaskwarriorService();
            if (tw) {
              try {
                tw.createTask(dto);
                loadLinkedEventIds();
                dialog.close();
                showStatus('Task created');
              } catch (err) {
                dialog.close();
                showStatus(
                  err instanceof Error ? err.message : 'Failed to create task',
                  true,
                );
              }
            } else {
              dialog.close();
              showStatus('TaskWarrior service not available', true);
            }
          }}
          onCancel={() => dialog.close()}
        />
      ),
      {
        size: 'large',
        gradStart: CALENDAR_GRAD[0],
        gradEnd: CALENDAR_GRAD[1],
      },
    );
  }

  useKeyboard((key) => {
    if (dialog.isOpen()) return;

    // Re-authenticate on token error
    if (key.name === 'a' && isAuthError()) {
      const cal = getCalendarService();
      if (!cal) return;
      void cal.getDefaultAccount().then((account) => {
        if (dialog.isOpen()) return;
        dialog.show(
          () => (
            <DialogGogAuth
              initialEmail={account ?? undefined}
              onSuccess={() => {
                dialog.close();
                loadEvents(selectedDate());
              }}
              onCancel={() => dialog.close()}
            />
          ),
          {
            size: 'large',
            gradStart: CALENDAR_GRAD[0],
            gradEnd: CALENDAR_GRAD[1],
          },
        );
      });
      return;
    }

    // Setup wizard on error
    if (key.name === 's' && error()) {
      const depService = getDependencyService();
      if (!depService) return;
      void depService.checkAll().then((depStatus: DependencyStatus) => {
        dialog.show(
          () => (
            <DialogSetupWizard
              status={depStatus}
              onCheckAgain={() => depService.checkAll()}
              onContinue={() => {
                dialog.close();
                loadEvents(selectedDate());
              }}
            />
          ),
          { size: 'large' },
        );
      });
      return;
    }

    // Date navigation: previous day
    if (key.name === 'left') {
      setSelectedDate((d) => addDays(d, -1));
      return;
    }
    // Date navigation: next day
    if (key.name === 'right') {
      setSelectedDate((d) => addDays(d, 1));
      return;
    }
    // Jump to today
    if (key.name === 't') {
      setSelectedDate(new Date());
      return;
    }
    // Previous week
    if (key.name === '[' || key.name === '{') {
      setSelectedDate((d) => addDays(d, -7));
      return;
    }
    // Next week
    if (key.name === ']' || key.name === '}') {
      setSelectedDate((d) => addDays(d, 7));
      return;
    }

    // Event list navigation: down
    if (key.name === 'j' || key.name === 'down') {
      setEventIndex((i) => Math.min(i + 1, Math.max(events().length - 1, 0)));
      return;
    }
    // Event list navigation: up
    if (key.name === 'k' || key.name === 'up') {
      setEventIndex((i) => Math.max(i - 1, 0));
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadEvents(selectedDate());
      return;
    }

    // Convert event to task / navigate to linked task
    if (key.name === 'return') {
      const eventList = events();
      const event = eventList[eventIndex()];
      if (!event) return;

      const taskUuid = linkedEventMap().get(event.id);
      if (taskUuid && props.onNavigateToTask) {
        props.onNavigateToTask(taskUuid);
      } else {
        openConvertDialog(event);
      }
      return;
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" flexGrow={1} width="100%">
        {/* Left pane: Date navigator */}
        <box
          flexDirection="column"
          width={navPaneWidth()}
          borderStyle="single"
          borderColor={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], 0.5)}
        >
          {/* Gradient top separator */}
          <box height={1} width="100%" flexDirection="row">
            <For each={Array.from({ length: innerNavWidth() }, (_, i) => i)}>
              {(i) => {
                const t = () =>
                  innerNavWidth() > 1 ? i / (innerNavWidth() - 1) : 0;
                return (
                  <text fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}>
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Pill header */}
          <box height={1} width="100%" paddingX={1} flexDirection="row">
            <text fg={CALENDAR_GRAD[0]}>{LEFT_CAP}</text>
            <For each={navHeaderLabel().split('')}>
              {(char, i) => {
                const t = () =>
                  navHeaderLabel().length > 1
                    ? i() / (navHeaderLabel().length - 1)
                    : 0;
                return (
                  <text
                    fg="#ffffff"
                    bg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}
                    attributes={1}
                  >
                    {char}
                  </text>
                );
              }}
            </For>
            <text fg={CALENDAR_GRAD[1]}>{RIGHT_CAP}</text>
          </box>

          {/* Gradient separator below header */}
          <box height={1} width="100%" flexDirection="row">
            <For each={Array.from({ length: innerNavWidth() }, (_, i) => i)}>
              {(i) => {
                const t = () =>
                  innerNavWidth() > 1 ? i / (innerNavWidth() - 1) : 0;
                return (
                  <text fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}>
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Content area */}
          <box paddingX={1} flexDirection="column">
            <box height={1}>
              <text fg={FG_PRIMARY} attributes={1}>
                {formatDateHeader(selectedDate())}
              </text>
            </box>
            <box height={1} />
            <box height={1} flexDirection="row">
              <text fg={FG_NORMAL} attributes={1}>
                {events().length}
              </text>
              <text fg={FG_MUTED}> events</text>
            </box>
            <box height={1} />
            <box height={1}>
              <text fg={FG_DIM}>{'[←/→] day  [t] today'}</text>
            </box>
            <box height={1}>
              <text fg={FG_DIM}>{'[[ / ]] week'}</text>
            </box>
          </box>
        </box>

        {/* Right pane: Event list */}
        <box
          flexDirection="column"
          width={eventPaneWidth()}
          flexGrow={1}
          borderStyle="single"
          borderColor={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], 0.5)}
        >
          {/* Gradient top separator */}
          <box height={1} width="100%" flexDirection="row">
            <For each={Array.from({ length: innerEventWidth() }, (_, i) => i)}>
              {(i) => {
                const t = () =>
                  innerEventWidth() > 1 ? i / (innerEventWidth() - 1) : 0;
                return (
                  <text fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}>
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Pill header */}
          <box height={1} width="100%" paddingX={1} flexDirection="row">
            <text fg={CALENDAR_GRAD[0]}>{LEFT_CAP}</text>
            <For each={eventHeaderLabel().split('')}>
              {(char, i) => {
                const t = () =>
                  eventHeaderLabel().length > 1
                    ? i() / (eventHeaderLabel().length - 1)
                    : 0;
                return (
                  <text
                    fg="#ffffff"
                    bg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}
                    attributes={1}
                  >
                    {char}
                  </text>
                );
              }}
            </For>
            <text fg={CALENDAR_GRAD[1]}>{RIGHT_CAP}</text>
          </box>

          {/* Gradient separator below header */}
          <box height={1} width="100%" flexDirection="row">
            <For each={Array.from({ length: innerEventWidth() }, (_, i) => i)}>
              {(i) => {
                const t = () =>
                  innerEventWidth() > 1 ? i / (innerEventWidth() - 1) : 0;
                return (
                  <text fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}>
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Content: Loading state */}
          <Show when={loading()}>
            <box paddingX={1}>
              <text fg={FG_DIM}>Loading events...</text>
            </box>
          </Show>

          {/* Content: Error state */}
          <Show when={error()}>
            <box paddingX={1} flexDirection="column">
              <text fg={COLOR_ERROR}>{error()}</text>
              <box height={1} />
              <text fg={FG_DIM}>
                {isAuthError()
                  ? 'Press [a] to re-authenticate, [s] for setup wizard, [r] to retry'
                  : 'Press [s] to open setup wizard, [r] to retry'}
              </text>
            </box>
          </Show>

          {/* Content: Empty state */}
          <Show when={!loading() && !error() && events().length === 0}>
            <box paddingX={1}>
              <text fg={FG_DIM}>No events for this day</text>
            </box>
          </Show>

          {/* Content: Event list */}
          <Show when={!loading() && !error() && events().length > 0}>
            <scrollbox flexGrow={1} width="100%">
              <For each={events()}>
                {(event, idx) => (
                  <box width="100%" flexDirection="column">
                    <EventCard
                      event={event}
                      isSelected={idx() === eventIndex()}
                      isLinked={linkedEventMap().has(event.id)}
                      width={Math.max(eventPaneWidth() - 2, 10)}
                    />
                    {/* Spacer between cards */}
                    <Show when={idx() < events().length - 1}>
                      <box height={1} />
                    </Show>
                  </box>
                )}
              </For>
            </scrollbox>
          </Show>

          {/* Bottom hints */}
          <Show when={!loading() && !error() && events().length > 0}>
            <box height={1} paddingX={1}>
              <text fg={FG_DIM}>
                {'[j/k] navigate  [Enter] convert/view task  [r] refresh'}
              </text>
            </box>
          </Show>

          {/* Status message */}
          <Show when={statusMsg()}>
            <box height={1} paddingX={1}>
              <text fg={statusIsError() ? COLOR_ERROR : COLOR_SUCCESS} attributes={1}>
                {statusMsg()}
              </text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  );
}
