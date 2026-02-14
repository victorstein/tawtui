import { Show, For } from 'solid-js';
import type { Task } from '../../taskwarrior.types';
import {
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_FAINT,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  COLOR_ERROR,
  TAG_COLORS,
  PROJECT_COLOR,
} from '../theme';

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

// TAG_COLORS and PROJECT_COLOR imported from theme

/**
 * Simple djb2 hash — maps a string to a consistent non-negative integer.
 * Used to assign a stable color to every tag name.
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Return a consistent color for a given tag name. */
function tagColor(tag: string): string {
  return TAG_COLORS[djb2(tag) % TAG_COLORS.length];
}

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
    const year = due.slice(0, 4);
    const month = due.slice(4, 6);
    const day = due.slice(6, 8);
    return `${month}/${day}`;
  } catch {
    return due;
  }
}

export function TaskCard(props: TaskCardProps) {
  const task = () => props.task;
  const selected = () => props.isSelected;

  const priorityBadge = () => {
    const p = task().priority;
    if (!p) return '';
    return `[${p}]`;
  };

  const priorityColor = () => {
    const p = task().priority;
    if (!p) return FG_DIM;
    return PRIORITY_COLORS[p] ?? FG_DIM;
  };

  /** Structured tag parts for individually colored rendering. */
  const tagParts = (): Array<{ text: string; color: string; underline?: boolean }> => {
    const parts: Array<{ text: string; color: string; underline?: boolean }> = [];

    // Project — rendered with distinct color and underline
    if (task().project) {
      parts.push({
        text: `+${task().project}`,
        color: PROJECT_COLOR,
        underline: true,
      });
    }

    // Tags — each gets a consistent hashed color
    if (task().tags && task().tags!.length > 0) {
      for (const tag of task().tags!) {
        parts.push({
          text: `+${tag}`,
          color: tagColor(tag),
        });
      }
    }

    // Due date
    if (task().due) {
      const dateStr = formatDueDate(task().due!);
      if (isOverdue(task().due!)) {
        parts.push({ text: `@${dateStr} OVERDUE`, color: COLOR_ERROR });
      } else {
        parts.push({ text: `@${dateStr}`, color: FG_DIM });
      }
    }

    // Dependency indicator
    if (task().depends) {
      parts.push({ text: 'BLOCKED', color: COLOR_ERROR });
    }

    return parts;
  };

  const hasTagParts = () => tagParts().length > 0;

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? BG_SELECTED : undefined}
      paddingX={1}
    >
      {/* First line: priority badge + description */}
      <box height={1} width="100%">
        <Show when={priorityBadge()}>
          <text fg={priorityColor()} attributes={1}>
            {priorityBadge() + ' '}
          </text>
        </Show>
        <text
          fg={selected() ? FG_PRIMARY : FG_NORMAL}
          attributes={selected() ? 1 : 0}
          truncate
        >
          {task().description}
        </text>
      </box>

      {/* Second line: tags, project, due date — each tag individually colored */}
      <Show when={hasTagParts()}>
        <box height={1} width="100%" flexDirection="row">
          <text fg={FG_FAINT}>{'  '}</text>
          <For each={tagParts()}>
            {(part, index) => (
              <>
                <Show when={index() > 0}>
                  <text fg={FG_FAINT}>{' '}</text>
                </Show>
                <text
                  fg={part.color}
                  attributes={part.underline ? 4 : 0}
                >
                  {part.text}
                </text>
              </>
            )}
          </For>
        </box>
      </Show>
    </box>
  );
}
