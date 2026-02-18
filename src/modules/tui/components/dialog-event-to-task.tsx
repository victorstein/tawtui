import { createSignal, Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type {
  CalendarEvent,
  CalendarEventDateTime,
} from '../../calendar.types';
import type { CreateTaskDto } from '../../taskwarrior.types';
import { darkenHex, formatTimeRange, lerpHex } from '../utils';
import {
  BG_INPUT,
  BG_INPUT_FOCUS,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  SEPARATOR_COLOR,
} from '../theme';

interface DialogEventToTaskProps {
  event: CalendarEvent;
  onConfirm: (dto: CreateTaskDto) => void;
  onCancel: () => void;
}

const BUTTONS = [
  {
    label: ' [Enter] Convert to Task ',
    gradStart: '#5aaa6a',
    gradEnd: '#2a7a8a',
  },
  { label: ' [Esc] Cancel ', gradStart: '#e05555', gradEnd: '#8a2a2a' },
] as const;

function formatDueDate(start: CalendarEventDateTime): string {
  if (start.dateTime) return start.dateTime;
  if (start.date) return start.date;
  return '';
}

function buildAnnotation(event: CalendarEvent): string {
  const lines: string[] = [`Calendar event: ${event.summary}`];
  lines.push(`Time: ${formatTimeRange(event.start, event.end)}`);
  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }
  if (event.description) {
    const trimmed =
      event.description.length > 200
        ? event.description.slice(0, 200) + '...'
        : event.description;
    lines.push(trimmed);
  }
  return lines.join('\n');
}

// Focus areas: 0 = title input, 1 = button row
type FocusArea = 0 | 1;

export function DialogEventToTask(props: DialogEventToTaskProps) {
  const [title, setTitle] = createSignal(props.event.summary);
  const [focusArea, setFocusArea] = createSignal<FocusArea>(0);
  const [buttonIndex, setButtonIndex] = createSignal(0);

  const timeRange = () => formatTimeRange(props.event.start, props.event.end);
  const dueDate = () => formatDueDate(props.event.start);

  const handleConfirm = () => {
    const desc = title().trim();
    if (!desc) return;

    const dto: CreateTaskDto = {
      description: desc,
      due: dueDate(),
      tags: ['meeting'],
      annotation: buildAnnotation(props.event),
    };
    props.onConfirm(dto);
  };

  useKeyboard((key) => {
    if (key.name === 'escape') {
      key.preventDefault();
      key.stopPropagation();
      props.onCancel();
      return;
    }

    if (key.name === 'tab') {
      key.preventDefault();
      key.stopPropagation();
      setFocusArea((prev) => ((prev + 1) % 2) as FocusArea);
      return;
    }

    if (focusArea() === 1) {
      if (key.name === 'left') {
        key.preventDefault();
        setButtonIndex(0);
        return;
      }
      if (key.name === 'right') {
        key.preventDefault();
        setButtonIndex(1);
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        if (buttonIndex() === 0) handleConfirm();
        else props.onCancel();
        return;
      }
      return;
    }

    // Focus area 0 — title input: Enter confirms (quick convert)
    if (key.name === 'return') {
      key.preventDefault();
      handleConfirm();
      return;
    }
  });

  const separatorLine = () => '\u2500'.repeat(50);

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Section 1 — Event Preview */}
      <box height={1}>
        <text fg={FG_PRIMARY} attributes={1}>
          {props.event.summary}
        </text>
      </box>
      <box height={1}>
        <text fg={FG_DIM}>{timeRange()}</text>
      </box>
      <Show when={props.event.location}>
        <box height={1}>
          <text fg={FG_MUTED}>{props.event.location}</text>
        </box>
      </Show>
      <Show
        when={
          props.event.attendees !== undefined &&
          (props.event.attendees?.length ?? 0) > 1
        }
      >
        <box height={1}>
          <text fg={FG_MUTED}>
            {props.event.attendees?.length ?? 0} attendees
          </text>
        </box>
      </Show>

      {/* Separator */}
      <box height={1}>
        <text fg={SEPARATOR_COLOR}>{separatorLine()}</text>
      </box>

      {/* Section 2 — Editable fields */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text
            fg={focusArea() === 0 ? FG_NORMAL : FG_DIM}
            attributes={focusArea() === 0 ? 1 : 0}
          >
            {focusArea() === 0 ? '> ' : '  '}Title
          </text>
        </box>
        <input
          width={50}
          value={title()}
          placeholder="Task title"
          focused={focusArea() === 0}
          backgroundColor={focusArea() === 0 ? BG_INPUT_FOCUS : BG_INPUT}
          textColor={FG_NORMAL}
          onInput={(val: string) => setTitle(val)}
        />
      </box>
      <box height={1} />

      <box height={1} flexDirection="row">
        <box width={14}>
          <text fg={FG_DIM}>{'  '}Due</text>
        </box>
        <text fg={FG_NORMAL}>{dueDate() || 'No date'}</text>
      </box>
      <box height={1} />

      <box height={1}>
        <text fg={FG_MUTED}>
          {'  '}Will add meeting details as annotation
        </text>
      </box>
      <box height={1} />

      {/* Navigation hint */}
      <box height={1}>
        <text fg={FG_MUTED}>{'[Tab] Switch focus'}</text>
      </box>
      <box height={1} />

      {/* Section 3 — Buttons */}
      <box height={1} flexDirection="row">
        <For each={[...BUTTONS]}>
          {(btn, idx) => {
            const isFocused = () =>
              focusArea() === 1 && buttonIndex() === idx();
            const chars = btn.label.split('');
            const dimBg = darkenHex(btn.gradStart, 0.3);
            return (
              <>
                {idx() > 0 && <text>{'  '}</text>}
                <box flexDirection="row">
                  {isFocused() ? (
                    <>
                      <text fg={btn.gradStart}>{'\uE0B6'}</text>
                      <For each={chars}>
                        {(char, i) => {
                          const t =
                            chars.length > 1 ? i() / (chars.length - 1) : 0;
                          return (
                            <text
                              fg="#ffffff"
                              bg={lerpHex(btn.gradStart, btn.gradEnd, t)}
                              attributes={1}
                            >
                              {char}
                            </text>
                          );
                        }}
                      </For>
                      <text fg={btn.gradEnd}>{'\uE0B4'}</text>
                    </>
                  ) : (
                    <>
                      <text fg={dimBg}>{'\uE0B6'}</text>
                      <text fg={btn.gradStart} bg={dimBg}>
                        {btn.label}
                      </text>
                      <text fg={dimBg}>{'\uE0B4'}</text>
                    </>
                  )}
                </box>
              </>
            );
          }}
        </For>
      </box>
    </box>
  );
}
