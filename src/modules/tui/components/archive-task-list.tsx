import { createEffect, For, Show } from 'solid-js';
import type { ScrollBoxRenderable } from '@opentui/core';
import type { Task } from '../../taskwarrior.types';
import { MONTH_NAMES, parseTwDate } from './archive-view';
import {
  ARCHIVE_GRAD,
  BG_SELECTED,
  BORDER_DIM,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_FAINT,
  FG_MUTED,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
  COLOR_WARNING,
} from '../theme';
import {
  lerpHex,
  darkenHex,
  LEFT_CAP,
  RIGHT_CAP,
  getTagGradient,
  VIRTUAL_TAGS,
} from '../utils';

const DIM_FACTOR = 0.5;

const PRIORITY_COLORS: Record<string, string> = {
  H: PRIORITY_H,
  M: PRIORITY_M,
  L: PRIORITY_L,
};

const PRIORITY_LABELS: Record<string, string> = {
  H: 'HIGH',
  M: 'MED',
  L: 'LOW',
};

function formatCompletionDate(dateStr: string): string {
  const date = parseTwDate(dateStr);
  if (!date) return dateStr;
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}`;
}

interface ArchiveTaskListProps {
  tasks: Task[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
  dateLabel: string | null;
  loading: boolean;
}

const CARD_HEIGHT = 4;

export default function ArchiveTaskList(props: ArchiveTaskListProps) {
  let scrollRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    const idx = props.selectedIndex;
    if (!scrollRef) return;
    scrollRef.scrollTo(idx * CARD_HEIGHT);
  });

  const headerLabel = () => ` COMPLETED (${props.tasks.length}) `;

  const gradStart = () => ARCHIVE_GRAD[0];
  const gradEnd = () => ARCHIVE_GRAD[1];
  const colorStart = () =>
    props.isActivePane ? gradStart() : darkenHex(gradStart(), DIM_FACTOR);
  const colorEnd = () =>
    props.isActivePane ? gradEnd() : darkenHex(gradEnd(), DIM_FACTOR);
  const innerWidth = () => Math.max(props.width - 2, 1);

  const borderColor = () =>
    props.isActivePane ? lerpHex(gradStart(), gradEnd(), 0.5) : BORDER_DIM;

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      height="100%"
      borderStyle="single"
      borderColor={borderColor()}
    >
      {/* Gradient top separator */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: innerWidth() }, (_, i) => i)}>
          {(i) => {
            const t = () => (innerWidth() > 1 ? i / (innerWidth() - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>
                {'\u2500'}
              </text>
            );
          }}
        </For>
      </box>

      {/* Pill header */}
      <box height={1} width="100%" paddingX={1} flexDirection="row">
        <text fg={gradStart()}>{LEFT_CAP}</text>
        <For each={headerLabel().split('')}>
          {(char, i) => {
            const t = () =>
              headerLabel().length > 1 ? i() / (headerLabel().length - 1) : 0;
            return (
              <text
                fg="#ffffff"
                bg={lerpHex(gradStart(), gradEnd(), t())}
                attributes={1}
              >
                {char}
              </text>
            );
          }}
        </For>
        <text fg={gradEnd()}>{RIGHT_CAP}</text>
      </box>

      {/* Gradient separator below header */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: innerWidth() }, (_, i) => i)}>
          {(i) => {
            const t = () => (innerWidth() > 1 ? i / (innerWidth() - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>
                {'\u2500'}
              </text>
            );
          }}
        </For>
      </box>

      {/* Sub-header: date label pill */}
      <Show when={props.dateLabel}>
        <box width="100%" paddingX={1} paddingBottom={1} flexDirection="row">
          <text fg={lerpHex(gradStart(), gradEnd(), 0.3)}>{LEFT_CAP}</text>
          <box backgroundColor={lerpHex(gradStart(), gradEnd(), 0.3)}>
            <text fg={FG_NORMAL}>{' ' + props.dateLabel + ' '}</text>
          </box>
          <text fg={lerpHex(gradStart(), gradEnd(), 0.3)}>{RIGHT_CAP}</text>
        </box>
      </Show>

      {/* Empty/loading states */}
      <Show when={!props.dateLabel && !props.loading}>
        <box paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>Select a date to view tasks</text>
        </box>
      </Show>
      <Show when={props.loading}>
        <box paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>Loading...</text>
        </box>
      </Show>
      <Show
        when={props.dateLabel && !props.loading && props.tasks.length === 0}
      >
        <box paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>No completed tasks</text>
        </box>
      </Show>

      {/* Task list */}
      <Show when={props.tasks.length > 0}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => {
            scrollRef = el;
          }}
          flexGrow={1}
          width="100%"
        >
          <For each={props.tasks}>
            {(task, index) => {
              const isCurrent = () => index() === props.selectedIndex;

              return <ArchiveTaskCard task={task} isSelected={isCurrent()} />;
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}

// ── Task card sub-component ─────────────────────────────────────

interface ArchiveTaskCardProps {
  task: Task;
  isSelected: boolean;
}

function ArchiveTaskCard(props: ArchiveTaskCardProps) {
  const task = () => props.task;
  const selected = () => props.isSelected;

  const priorityLabel = () => {
    const p = task().priority;
    if (!p) return '';
    return PRIORITY_LABELS[p] ?? '';
  };

  const priorityColor = () => {
    const p = task().priority;
    if (!p) return FG_DIM;
    return PRIORITY_COLORS[p] ?? FG_DIM;
  };

  const projectPart = () => {
    if (!task().project) return null;
    return { text: task().project!, fg: FG_PRIMARY, bg: PROJECT_COLOR };
  };

  const tagParts = () => {
    if (!task().tags || task().tags!.length === 0) return [];
    return task()
      .tags!.filter((tag) => !VIRTUAL_TAGS.has(tag))
      .map((tag) => ({
        text: tag,
        grad: getTagGradient(tag),
      }));
  };

  const hasMetaParts = () => !!projectPart() || tagParts().length > 0;

  const completionText = () => {
    if (!task().end) return null;
    return formatCompletionDate(task().end!);
  };

  const annotationCount = () => {
    if (!task().annotations || task().annotations!.length === 0) return 0;
    return task().annotations!.length;
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? BG_SELECTED : undefined}
      paddingX={1}
      paddingBottom={1}
    >
      {/* Line 1: priority badge + description */}
      <box height={1} width="100%" flexDirection="row">
        <Show when={priorityLabel()}>
          <box backgroundColor={priorityColor()} marginRight={1}>
            <text fg={FG_PRIMARY} attributes={1}>
              {' ' + priorityLabel() + ' '}
            </text>
          </box>
        </Show>
        <text
          fg={selected() ? FG_PRIMARY : FG_NORMAL}
          attributes={selected() ? 1 : 0}
          truncate
        >
          {task().description}
        </text>
      </box>

      {/* Line 2: project (rectangular) + tag pills (rounded caps) */}
      <Show when={hasMetaParts()}>
        <box width="100%" flexDirection="row" flexWrap="wrap">
          <text fg={FG_FAINT}>{'  '}</text>
          {/* Project pill — rectangular */}
          <Show when={projectPart()}>
            <box backgroundColor={projectPart()!.bg} paddingX={1}>
              <text fg={projectPart()!.fg} attributes={1}>
                {projectPart()!.text}
              </text>
            </box>
          </Show>
          {/* Tag pills — rounded with powerline caps */}
          <For each={tagParts()}>
            {(part, index) => {
              const chars = (' ' + part.text.toUpperCase() + ' ').split('');
              return (
                <box flexDirection="row">
                  <Show when={index() > 0 || !!projectPart()}>
                    <text> </text>
                  </Show>
                  <text fg={part.grad.start}>{'\uE0B6'}</text>
                  <For each={chars}>
                    {(char, i) => {
                      const t = chars.length > 1 ? i() / (chars.length - 1) : 0;
                      return (
                        <text
                          fg="#ffffff"
                          bg={lerpHex(part.grad.start, part.grad.end, t)}
                        >
                          {char}
                        </text>
                      );
                    }}
                  </For>
                  <text fg={part.grad.end}>{'\uE0B4'}</text>
                </box>
              );
            }}
          </For>
        </box>
      </Show>

      {/* Line 3: checkmark + completed date + annotation count */}
      <box height={1} width="100%" flexDirection="row">
        <text fg={FG_FAINT}>{'  '}</text>
        <text fg={darkenHex(COLOR_WARNING, 0.7)}>{'\u2713'}</text>
        <Show when={completionText()}>
          <text fg={FG_MUTED}>{' completed ' + completionText()}</text>
        </Show>
        <Show when={annotationCount() > 0}>
          <text fg={FG_FAINT}>
            {'  ' +
              annotationCount() +
              ' annotation' +
              (annotationCount() > 1 ? 's' : '')}
          </text>
        </Show>
      </box>
    </box>
  );
}
