import { Show, For } from 'solid-js';
import type { Task } from '../../taskwarrior.types';
import {
  BG_SELECTED,
  CALENDAR_GRAD,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_FAINT,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  COLOR_ERROR,
  PROJECT_COLOR,
} from '../theme';
import {
  getTagGradient,
  lerpHex,
  LEFT_CAP,
  RIGHT_CAP,
  VIRTUAL_TAGS,
} from '../utils';

interface TaskCardProps {
  task: Task;
  isSelected: boolean;
  width: number;
}

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

const MONTHS = [
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

function isOverdue(due: string): boolean {
  try {
    // Taskwarrior stores dates as ISO 8601 strings (e.g., "20260214T120000Z")
    const year = due.slice(0, 4);
    const month = due.slice(4, 6);
    const day = due.slice(6, 8);
    const dueDate = new Date(`${year}-${month}-${day}`);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return dueDate < now;
  } catch {
    return false;
  }
}

function formatDueDate(due: string): string {
  try {
    const year = parseInt(due.slice(0, 4), 10);
    const monthIdx = parseInt(due.slice(4, 6), 10) - 1;
    const day = parseInt(due.slice(6, 8), 10);
    const currentYear = new Date().getFullYear();
    const monthName = MONTHS[monthIdx];
    if (year !== currentYear) {
      return `${monthName} ${day}, ${year}`;
    }
    return `${monthName} ${day}`;
  } catch {
    return due;
  }
}

export function TaskCard(props: TaskCardProps) {
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

  const isCalendarLinked = () => {
    const id = task().calendar_event_id;
    return typeof id === 'string' && id.length > 0;
  };

  /** Project pill (rectangular, no caps). */
  const projectPart = () => {
    if (!task().project) return null;
    return { text: task().project!, fg: FG_PRIMARY, bg: PROJECT_COLOR };
  };

  /** Tag pills (rounded with powerline caps). */
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

  const recurrenceText = () => {
    if (task().recur) return task().recur!;
    if (task().parent) return 'recurring';
    return null;
  };

  /** Due date + recurrence + BLOCKED indicator for line 3. */
  const hasDueLine = () =>
    !!task().due || !!task().depends || !!recurrenceText();

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? BG_SELECTED : undefined}
      paddingX={1}
    >
      {/* Line 1: priority pill + description */}
      <box height={1} width="100%" flexDirection="row">
        <Show when={priorityLabel()}>
          <box backgroundColor={priorityColor()} marginRight={1}>
            <text fg={FG_PRIMARY} attributes={1}>
              {' ' + priorityLabel() + ' '}
            </text>
          </box>
        </Show>
        <Show when={isCalendarLinked()}>
          <box flexDirection="row" marginRight={1}>
            <text fg={CALENDAR_GRAD[0]}>{LEFT_CAP}</text>
            <For each={' CAL '.split('')}>
              {(char, i) => {
                const t = 4 > 1 ? i() / 4 : 0;
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

      {/* Line 3: recurrence + due date + BLOCKED indicator */}
      <Show when={hasDueLine()}>
        <box height={1} width="100%" flexDirection="row">
          <text fg={FG_FAINT}>{'  '}</text>
          <Show when={recurrenceText()}>
            <text fg="#8a7aaa">{'↻ ' + recurrenceText()}</text>
            <Show when={task().due}>
              <text fg={FG_FAINT}>{'  '}</text>
            </Show>
          </Show>
          <Show when={task().due}>
            {(() => {
              const overdue = isOverdue(task().due!);
              const dateStr = formatDueDate(task().due!);
              return (
                <>
                  <text fg={FG_FAINT}>{'Due: '}</text>
                  <text fg={overdue ? COLOR_ERROR : FG_DIM}>
                    {overdue ? `${dateStr} OVERDUE` : dateStr}
                  </text>
                </>
              );
            })()}
          </Show>
          <Show when={task().depends}>
            <Show when={task().due}>
              <text fg={FG_FAINT}>{'  '}</text>
            </Show>
            <text fg={COLOR_ERROR} attributes={1}>
              {'BLOCKED'}
            </text>
          </Show>
        </box>
      </Show>
    </box>
  );
}
