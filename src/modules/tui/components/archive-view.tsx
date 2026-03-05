import {
  createSignal,
  createEffect,
  createMemo,
  on,
  type Accessor,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { Task } from '../../taskwarrior.types';
import { DialogConfirm } from './dialog-confirm';
import { useDialog } from '../context/dialog';
import { getTaskwarriorService } from '../bridge';
import { DateList, type DateGroup } from './date-list';
import ArchiveTaskList from './archive-task-list';

export const MONTH_NAMES = [
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

/** Parse a Taskwarrior date string (YYYYMMDDTHHMMSSZ) into a Date object. */
export function parseTwDate(dateStr: string): Date | null {
  try {
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    const h = parseInt(dateStr.slice(9, 11), 10);
    const min = parseInt(dateStr.slice(11, 13), 10);
    const s = parseInt(dateStr.slice(13, 15), 10);
    return new Date(Date.UTC(y, m, d, h, min, s));
  } catch {
    return null;
  }
}

/** Format a Date as "Mon DD, YYYY" (e.g., "Feb 13, 2026"). */
function formatDateHeader(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}

/** Get the date-only key (YYYY-MM-DD in local time) from a Taskwarrior date string. */
function getDateKey(dateStr: string): string {
  const date = parseTwDate(dateStr);
  if (!date) return 'unknown';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Group tasks by their completion date (local time), sorted by date descending.
 * Tasks within each group are sorted by end date descending.
 */
function groupByDate(tasks: Task[]): DateGroup[] {
  const sorted = [...tasks].sort((a, b) => {
    const aEnd = a.end ?? '';
    const bEnd = b.end ?? '';
    return bEnd.localeCompare(aEnd);
  });

  const groups = new Map<string, { label: string; tasks: Task[] }>();

  for (const task of sorted) {
    if (!task.end) continue;
    const key = getDateKey(task.end);
    if (!groups.has(key)) {
      const date = parseTwDate(task.end);
      const label = date ? formatDateHeader(date) : key;
      groups.set(key, { label, tasks: [] });
    }
    groups.get(key)!.tasks.push(task);
  }

  const result: DateGroup[] = [];
  for (const [date, group] of groups) {
    result.push({ date, label: group.label, tasks: group.tasks });
  }

  return result;
}

/** Pane identifiers for the split-pane layout. */
type Pane = 'dates' | 'tasks';

interface ArchiveViewProps {
  isActive: Accessor<boolean>;
}

export function ArchiveView(props: ArchiveViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  // Active pane state
  const [activePane, setActivePane] = createSignal<Pane>('dates');

  // Raw task data
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [, setError] = createSignal<string | null>(null);

  // Pane selection indices
  const [dateIndex, setDateIndex] = createSignal(0);
  const [taskIndex, setTaskIndex] = createSignal(0);

  // Derived: date groups from raw tasks
  const dateGroups = createMemo(() => groupByDate(tasks()));

  // Derived: tasks for the currently selected date group
  const selectedDateTasks = createMemo(() => {
    const groups = dateGroups();
    const idx = dateIndex();
    if (groups.length === 0 || idx >= groups.length) return [];
    return groups[idx].tasks;
  });

  // Reset task index when the selected date changes
  createEffect(
    on(dateIndex, () => {
      setTaskIndex(0);
    }),
  );

  // Clamp dateIndex when date groups change
  createEffect(() => {
    const maxIdx = dateGroups().length - 1;
    if (dateIndex() > maxIdx) {
      setDateIndex(Math.max(maxIdx, 0));
    }
  });

  // Clamp taskIndex when tasks for selected date change
  createEffect(() => {
    const maxIdx = selectedDateTasks().length - 1;
    if (taskIndex() > maxIdx) {
      setTaskIndex(Math.max(maxIdx, 0));
    }
  });

  /** Fetch archived (completed before today) tasks. */
  function loadArchive(): void {
    const tw = getTaskwarriorService();
    if (!tw) {
      setError('TaskwarriorService not available');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const completed = tw.getTasks('status:completed end.before:today');
      setTasks(completed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive');
    } finally {
      setLoading(false);
    }
  }

  // Load archive when the view becomes active
  createEffect(() => {
    if (props.isActive()) {
      loadArchive();
    }
  });

  /** Get the currently selected task from the right pane. */
  function selectedTask(): Task | null {
    const taskList = selectedDateTasks();
    const idx = taskIndex();
    return taskList[idx] ?? null;
  }

  // Keyboard navigation
  useKeyboard((key) => {
    if (!props.isActive()) return;
    if (dialog.isOpen()) return;

    const pane = activePane();

    // Pane switching: h/l or Left/Right
    if (key.name === 'h' || key.name === 'left') {
      setActivePane('dates');
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      if (dateGroups().length > 0) {
        setActivePane('tasks');
      }
      return;
    }

    // Within-pane navigation: j/k
    if (key.name === 'j' || key.name === 'down') {
      if (pane === 'dates') {
        setDateIndex((i) =>
          Math.min(i + 1, Math.max(dateGroups().length - 1, 0)),
        );
      } else {
        setTaskIndex((i) =>
          Math.min(i + 1, Math.max(selectedDateTasks().length - 1, 0)),
        );
      }
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      if (pane === 'dates') {
        setDateIndex((i) => Math.max(i - 1, 0));
      } else {
        setTaskIndex((i) => Math.max(i - 1, 0));
      }
      return;
    }

    // Undo: mark completed task as pending again (right pane only)
    if (key.name === 'u' && !key.shift) {
      if (pane !== 'tasks') return;
      const task = selectedTask();
      if (!task) return;

      const tw = getTaskwarriorService();
      if (!tw) return;
      try {
        tw.undoComplete(task.uuid);
      } catch {
        // Silently ignore; refresh will show current state
      }
      loadArchive();
      return;
    }

    // Delete: permanently delete task (with confirmation, right pane only)
    if (key.name === 'D' || (key.name === 'd' && key.shift)) {
      if (pane !== 'tasks') return;
      const task = selectedTask();
      if (!task) return;

      dialog.show(
        () => (
          <DialogConfirm
            message={`Permanently delete "${task.description}"?`}
            onConfirm={() => {
              const tw = getTaskwarriorService();
              if (tw) {
                try {
                  tw.deleteTask(task.uuid);
                } catch {
                  // Silently ignore
                }
                loadArchive();
              }
              dialog.close();
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'medium' },
      );
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadArchive();
      return;
    }
  });

  // Calculate pane widths from terminal dimensions
  const width = () => dimensions().width;

  const datePaneWidth = () => Math.max(Math.floor(width() * 0.3), 25);
  const taskPaneWidth = () => width() - datePaneWidth();

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" flexGrow={1} width="100%">
        <DateList
          dates={dateGroups()}
          selectedIndex={dateIndex()}
          isActivePane={activePane() === 'dates'}
          width={datePaneWidth()}
        />
        <ArchiveTaskList
          tasks={selectedDateTasks()}
          selectedIndex={taskIndex()}
          isActivePane={activePane() === 'tasks'}
          width={taskPaneWidth()}
          dateLabel={dateGroups()[dateIndex()]?.label ?? null}
          loading={loading()}
        />
      </box>
    </box>
  );
}
