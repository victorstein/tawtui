import { createSignal, createEffect, on, onMount, Show, For } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { CalendarEvent } from '../../calendar.types';
import type { CreateTaskDto } from '../../taskwarrior.types';
import type { DependencyStatus } from '../../dependency.types';
import { EventCard } from '../components/event-card';
import { DialogEventToTask } from '../components/dialog-event-to-task';
import { DialogSetupWizard } from '../components/dialog-setup-wizard';
import { useDialog } from '../context/dialog';
import {
  getCalendarService,
  getTaskwarriorService,
  getConfigService,
  getDependencyService,
} from '../bridge';
import {
  FG_PRIMARY,
  FG_DIM,
  FG_MUTED,
  COLOR_ERROR,
  BORDER_DIM,
} from '../theme';
import { lerpHex } from '../utils';

interface CalendarViewProps {
  refreshTrigger?: () => number;
}

const CALENDAR_GRAD: [string, string] = ['#5aaaa0', '#2a8a7a'];

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
      result.sort((a, b) => {
        const aTime = a.start.dateTime ?? a.start.date ?? '';
        const bTime = b.start.dateTime ?? b.start.date ?? '';
        return aTime.localeCompare(bTime);
      });
      setEvents(result);
      if (eventIndex() >= result.length) {
        setEventIndex(Math.max(result.length - 1, 0));
      }
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
    on(selectedDate, (date) => {
      loadEvents(date);
    }, { defer: true }),
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

  useKeyboard((key) => {
    if (dialog.isOpen()) return;

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
      setEventIndex((i) =>
        Math.min(i + 1, Math.max(events().length - 1, 0)),
      );
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

    // Convert event to task
    if (key.name === 'return') {
      const eventList = events();
      const event = eventList[eventIndex()];
      if (!event) return;

      dialog.show(
        () => (
          <DialogEventToTask
            event={event}
            onConfirm={async (dto: CreateTaskDto) => {
              const tw = getTaskwarriorService();
              if (tw) {
                try {
                  await tw.createTask(dto);
                } catch {
                  // Task creation failed — still close the dialog
                }
              }
              dialog.close();
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'large', gradStart: CALENDAR_GRAD[0], gradEnd: CALENDAR_GRAD[1] },
      );
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
          borderRight
          borderColor={BORDER_DIM}
        >
          {/* Gradient header */}
          <box height={1} width="100%" flexDirection="row">
            <For each={Array.from({ length: navPaneWidth() }, (_, i) => i)}>
              {(i) => {
                const t = () =>
                  navPaneWidth() > 1 ? i / (navPaneWidth() - 1) : 0;
                return (
                  <text
                    fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}
                  >
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Date display */}
          <box paddingX={1} flexDirection="column">
            <box height={1}>
              <text fg={FG_PRIMARY} attributes={1}>
                {formatDateShort(selectedDate())}
              </text>
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
        <box flexDirection="column" width={eventPaneWidth()} flexGrow={1}>
          {/* Gradient header */}
          <box height={1} width="100%" flexDirection="row">
            <For
              each={Array.from({ length: eventPaneWidth() }, (_, i) => i)}
            >
              {(i) => {
                const t = () =>
                  eventPaneWidth() > 1 ? i / (eventPaneWidth() - 1) : 0;
                return (
                  <text
                    fg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t())}
                  >
                    {'\u2500'}
                  </text>
                );
              }}
            </For>
          </box>

          {/* Title */}
          <box height={1} paddingX={1}>
            <text fg={FG_PRIMARY} attributes={1}>
              {'Events \u2014 '}
              {formatDateHeader(selectedDate())}
            </text>
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
                {'Press [s] to open setup wizard, [r] to retry'}
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
            <box flexDirection="column" flexGrow={1} overflow="hidden">
              <For each={events()}>
                {(event, idx) => (
                  <EventCard
                    event={event}
                    isSelected={idx() === eventIndex()}
                    width={eventPaneWidth()}
                  />
                )}
              </For>
            </box>
          </Show>

          {/* Bottom hints */}
          <Show when={!loading() && !error() && events().length > 0}>
            <box height={1} paddingX={1}>
              <text fg={FG_MUTED}>
                {'[j/k] navigate  [Enter] convert to task  [r] refresh'}
              </text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  );
}
