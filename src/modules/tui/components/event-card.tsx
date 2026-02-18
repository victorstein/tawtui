import { Show } from 'solid-js';
import type { CalendarEvent } from '../../calendar.types';
import { formatTimeRange } from '../utils';
import {
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  FG_FAINT,
} from '../theme';

interface EventCardProps {
  event: CalendarEvent;
  isSelected: boolean;
  width: number;
}

export function EventCard(props: EventCardProps) {
  const event = () => props.event;
  const selected = () => props.isSelected;

  const timeRange = () => formatTimeRange(event().start, event().end);

  const hasSecondLine = () =>
    !!event().location ||
    (event().attendees !== undefined && (event().attendees?.length ?? 0) > 1);

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? BG_SELECTED : undefined}
      paddingX={1}
    >
      {/* Line 1: time range + event title */}
      <box height={1} width="100%" flexDirection="row">
        <text fg={FG_DIM}>{timeRange()}</text>
        <text fg={FG_DIM}>{' '}</text>
        <text
          fg={selected() ? FG_PRIMARY : FG_NORMAL}
          attributes={selected() ? 1 : 0}
          truncate
        >
          {event().summary}
        </text>
      </box>

      {/* Line 2: location or attendee count */}
      <Show when={hasSecondLine()}>
        <box height={1} width="100%" flexDirection="row">
          <Show
            when={event().location}
            fallback={
              <text fg={FG_MUTED} truncate>
                {'  '}
                {event().attendees?.length ?? 0} attendees
              </text>
            }
          >
            <text fg={FG_FAINT} truncate>
              {'  '}
              {event().location}
            </text>
          </Show>
        </box>
      </Show>
    </box>
  );
}
