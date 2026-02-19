import { Show, For } from 'solid-js';
import type { CalendarEvent } from '../../calendar.types';
import {
  formatTimeRange,
  getEventGradient,
  getTagGradient,
  lerpHex,
  LEFT_CAP,
  RIGHT_CAP,
} from '../utils';
import {
  ACCENT_SECONDARY,
  BG_SELECTED,
  CALENDAR_GRAD,
  COLOR_ERROR,
  COLOR_WARNING,
  FG_PRIMARY,
  FG_NORMAL,
  FG_MUTED,
  FG_FAINT,
} from '../theme';

interface EventCardProps {
  event: CalendarEvent;
  isSelected: boolean;
  isLinked?: boolean;
  width: number;
}

export function EventCard(props: EventCardProps) {
  const event = () => props.event;
  const selected = () => props.isSelected;

  const timePillText = () =>
    ' ' + formatTimeRange(event().start, event().end) + ' ';

  const statusBadge = () => {
    const s = event().status;
    if (s === 'cancelled') return { label: ' CANCELLED ', bg: COLOR_ERROR };
    if (s === 'tentative') return { label: ' TENTATIVE ', bg: COLOR_WARNING };
    return null;
  };

  const hasMetaLine = () =>
    !!event().calendarId ||
    (event().attendees !== undefined && (event().attendees?.length ?? 0) > 1);

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? BG_SELECTED : undefined}
      paddingX={1}
    >
      {/* Line 1: time pill + status badge + title */}
      <box height={1} width="100%" flexDirection="row">
        {(() => {
          const chars = timePillText().split('');
          const grad = getEventGradient(event().id);
          return (
            <box flexDirection="row" marginRight={1}>
              <text fg={grad.start}>{LEFT_CAP}</text>
              <For each={chars}>
                {(char, i) => {
                  const t = chars.length > 1 ? i() / (chars.length - 1) : 0;
                  return (
                    <text fg="#ffffff" bg={lerpHex(grad.start, grad.end, t)}>
                      {char}
                    </text>
                  );
                }}
              </For>
              <text fg={grad.end}>{RIGHT_CAP}</text>
            </box>
          );
        })()}
        <Show when={statusBadge()}>
          <box backgroundColor={statusBadge()!.bg} marginRight={1}>
            <text fg="#ffffff" attributes={1}>
              {statusBadge()!.label}
            </text>
          </box>
        </Show>
        <Show when={props.isLinked}>
          {(() => {
            const chars = ' TASK '.split('');
            return (
              <box flexDirection="row" marginRight={1}>
                <text fg={CALENDAR_GRAD[0]}>{LEFT_CAP}</text>
                <For each={chars}>
                  {(char, i) => {
                    const t = chars.length > 1 ? i() / (chars.length - 1) : 0;
                    return (
                      <text
                        fg="#ffffff"
                        bg={lerpHex(CALENDAR_GRAD[0], CALENDAR_GRAD[1], t)}
                      >
                        {char}
                      </text>
                    );
                  }}
                </For>
                <text fg={CALENDAR_GRAD[1]}>{RIGHT_CAP}</text>
              </box>
            );
          })()}
        </Show>
        <text
          fg={selected() ? FG_PRIMARY : FG_NORMAL}
          attributes={selected() ? 1 : 0}
          truncate
        >
          {event().summary}
        </text>
      </box>

      {/* Line 2: calendar name pill + attendees */}
      <Show when={hasMetaLine()}>
        <box width="100%" flexDirection="row">
          <text fg={FG_FAINT}>{'  '}</text>
          <Show when={event().calendarId}>
            {(() => {
              const calId = event().calendarId!;
              const chars = (' ' + calId + ' ').split('');
              const grad = getTagGradient(calId);
              return (
                <box flexDirection="row">
                  <text fg={grad.start}>{LEFT_CAP}</text>
                  <For each={chars}>
                    {(char, i) => {
                      const t = chars.length > 1 ? i() / (chars.length - 1) : 0;
                      return (
                        <text
                          fg="#ffffff"
                          bg={lerpHex(grad.start, grad.end, t)}
                        >
                          {char}
                        </text>
                      );
                    }}
                  </For>
                  <text fg={grad.end}>{RIGHT_CAP}</text>
                </box>
              );
            })()}
          </Show>
          <Show
            when={
              event().attendees !== undefined &&
              (event().attendees?.length ?? 0) > 1
            }
          >
            <text fg={ACCENT_SECONDARY} attributes={1}>
              {' '}
              {event().attendees?.length ?? 0}
            </text>
            <text fg={FG_MUTED}> attendees</text>
          </Show>
        </box>
      </Show>

      {/* Line 3: location */}
      <Show when={event().location}>
        <box height={1} width="100%" flexDirection="row">
          <text fg={FG_FAINT}>{'\u0020\u0020\u2022 '}</text>
          <text fg={FG_MUTED} truncate>
            {event().location}
          </text>
        </box>
      </Show>
    </box>
  );
}
