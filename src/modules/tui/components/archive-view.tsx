import {
  createSignal,
  createEffect,
  onMount,
  Show,
  For,
  type Accessor,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { Task } from '../../taskwarrior.types';
import type { TaskwarriorService } from '../../taskwarrior.service';
import { DialogConfirm } from './dialog-confirm';
import { useDialog } from '../context/dialog';

/**
 * Access the TaskwarriorService bridged from NestJS DI via globalThis.
 */
function getTaskwarriorService(): TaskwarriorService | null {
  return (globalThis as any).__tawtui?.taskwarriorService ?? null;
}

const PRIORITY_COLORS: Record<string, string> = {
  H: '#e94560',
  M: '#f0a500',
  L: '#4ecca3',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Parse a Taskwarrior date string (YYYYMMDDTHHMMSSZ) into a Date object.
 */
function parseTwDate(dateStr: string): Date | null {
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

/**
 * Format a Date as "Mon DD, YYYY" (e.g., "Feb 13, 2026").
 */
function formatDateHeader(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}

/**
 * Format a Taskwarrior date string for display as a short date/time.
 */
function formatCompletionDate(dateStr: string): string {
  const date = parseTwDate(dateStr);
  if (!date) return dateStr;
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}`;
}

/**
 * Get the date-only key (YYYY-MM-DD in local time) from a Taskwarrior date string.
 */
function getDateKey(dateStr: string): string {
  const date = parseTwDate(dateStr);
  if (!date) return 'unknown';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface DateGroup {
  dateKey: string;
  label: string;
  tasks: Task[];
}

/**
 * Group tasks by their completion date (local time), sorted by date descending.
 * Tasks within each group are sorted by end date descending.
 */
function groupByDate(tasks: Task[]): DateGroup[] {
  // Sort all tasks by end date descending
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

  // Convert to array (already ordered by descending date since tasks were sorted)
  const result: DateGroup[] = [];
  for (const [dateKey, group] of groups) {
    result.push({ dateKey, label: group.label, tasks: group.tasks });
  }

  return result;
}

/**
 * A flat list item: either a date header or a task row.
 */
type FlatItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task };

/**
 * Flatten grouped tasks into a list of headers and task rows
 * for linear navigation.
 */
function flattenGroups(groups: DateGroup[]): FlatItem[] {
  const items: FlatItem[] = [];
  for (const group of groups) {
    items.push({ type: 'header', label: group.label });
    for (const task of group.tasks) {
      items.push({ type: 'task', task });
    }
  }
  return items;
}

interface ArchiveViewProps {
  isActive: Accessor<boolean>;
}

export function ArchiveView(props: ArchiveViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  // Derived: grouped and flattened items
  const groups = () => groupByDate(tasks());
  const flatItems = () => flattenGroups(groups());

  // Find the indices that correspond to task items (skipping headers)
  const taskIndices = () => {
    const items = flatItems();
    const indices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'task') {
        indices.push(i);
      }
    }
    return indices;
  };

  // The currently selected task-item index within taskIndices
  const selectedTaskIdx = () => {
    const tIdx = taskIndices();
    const sel = selectedIndex();
    if (sel < 0 || sel >= tIdx.length) return -1;
    return tIdx[sel];
  };

  // The currently selected task
  const selectedTask = (): Task | null => {
    const idx = selectedTaskIdx();
    if (idx < 0) return null;
    const item = flatItems()[idx];
    if (item?.type === 'task') return item.task;
    return null;
  };

  /** Fetch archived (completed before today) tasks. */
  async function loadArchive(): Promise<void> {
    const tw = getTaskwarriorService();
    if (!tw) {
      setError('TaskwarriorService not available');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const completed = await tw.getTasks('status:completed end.before:today');
      setTasks(completed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load archive',
      );
    } finally {
      setLoading(false);
    }
  }

  // Clamp selected index when data changes
  createEffect(() => {
    const maxIdx = taskIndices().length - 1;
    if (selectedIndex() > maxIdx) {
      setSelectedIndex(Math.max(maxIdx, 0));
    }
  });

  // Load archive when the view becomes active
  createEffect(() => {
    if (props.isActive()) {
      loadArchive();
    }
  });

  // Also load on mount if already active
  onMount(() => {
    if (props.isActive()) {
      loadArchive();
    }
  });

  // Keyboard navigation
  useKeyboard((key) => {
    if (!props.isActive()) return;
    if (dialog.isOpen()) return;

    // Navigate down
    if (key.name === 'j' || key.name === 'down') {
      const maxIdx = taskIndices().length - 1;
      setSelectedIndex((i) => Math.min(i + 1, Math.max(maxIdx, 0)));
      return;
    }

    // Navigate up
    if (key.name === 'k' || key.name === 'up') {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }

    // Undo: mark completed task as pending again
    if (key.name === 'u' && !key.shift) {
      const task = selectedTask();
      if (!task) return;

      // The updateTask DTO doesn't support status changes, so we spawn
      // `task <uuid> modify status:pending` directly via Bun.
      (async () => {
        try {
          Bun.spawnSync(
            [
              'task',
              'rc.confirmation=off',
              'rc.bulk=0',
              'rc.verbose=nothing',
              task.uuid,
              'modify',
              'status:pending',
            ],
            { stdout: 'pipe', stderr: 'pipe' },
          );
        } catch {
          // Silently ignore; refresh will show current state
        }
        await loadArchive();
      })();
      return;
    }

    // Delete: permanently delete task (with confirmation)
    if (key.name === 'D' || (key.name === 'd' && key.shift)) {
      const task = selectedTask();
      if (!task) return;

      dialog.show(
        () => (
          <DialogConfirm
            message={`Permanently delete "${task.description}"?`}
            onConfirm={async () => {
              const tw = getTaskwarriorService();
              if (tw) {
                try {
                  await tw.deleteTask(task.uuid);
                } catch {
                  // Silently ignore
                }
                await loadArchive();
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

  const contentWidth = () => dimensions().width;

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {/* Archive header */}
      <box height={1} paddingX={1}>
        <text fg="#e94560" attributes={1}>
          {'ARCHIVE'}
        </text>
        <text fg="#888888">
          {` \u2014 ${tasks().length} completed task${tasks().length !== 1 ? 's' : ''}`}
        </text>
      </box>

      {/* Separator */}
      <box height={1} paddingX={1}>
        <text fg="#333333" truncate>
          {'\u2500'.repeat(Math.max(contentWidth() - 2, 1))}
        </text>
      </box>

      {/* Loading */}
      <Show when={loading() && tasks().length === 0}>
        <box height={1} paddingX={1}>
          <text fg="#888888">Loading archive...</text>
        </box>
      </Show>

      {/* Error */}
      <Show when={error()}>
        <box height={1} paddingX={1}>
          <text fg="#e94560">Error: {error()}</text>
        </box>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && !error() && tasks().length === 0}>
        <box paddingX={2} paddingY={1}>
          <text fg="#555555">No archived tasks found.</text>
        </box>
      </Show>

      {/* Task list grouped by date */}
      <Show when={flatItems().length > 0}>
        <scrollbox flexGrow={1} width="100%">
          <For each={flatItems()}>
            {(item, flatIdx) => (
              <Show
                when={item.type === 'header'}
                fallback={
                  <ArchiveTaskRow
                    task={(item as { type: 'task'; task: Task }).task}
                    isSelected={selectedTaskIdx() === flatIdx()}
                    width={contentWidth()}
                  />
                }
              >
                <box height={1} paddingX={1} marginTop={flatIdx() > 0 ? 1 : 0}>
                  <text fg="#e94560" attributes={1}>
                    {(item as { type: 'header'; label: string }).label}
                  </text>
                </box>
              </Show>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}

interface ArchiveTaskRowProps {
  task: Task;
  isSelected: boolean;
  width: number;
}

function ArchiveTaskRow(props: ArchiveTaskRowProps) {
  const task = () => props.task;
  const selected = () => props.isSelected;

  const priorityBadge = () => {
    const p = task().priority;
    if (!p) return '';
    return `[${p}]`;
  };

  const priorityColor = () => {
    const p = task().priority;
    if (!p) return '#888888';
    return PRIORITY_COLORS[p] ?? '#888888';
  };

  const metaLine = () => {
    const parts: string[] = [];

    // Completion date/time
    if (task().end) {
      parts.push(`completed ${formatCompletionDate(task().end!)}`);
    }

    // Project
    if (task().project) {
      parts.push(`+${task().project}`);
    }

    return parts.join('  ');
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={selected() ? '#16213e' : undefined}
      paddingX={2}
    >
      {/* First line: priority badge + description */}
      <box height={1} width="100%">
        <Show when={priorityBadge()}>
          <text fg={priorityColor()} attributes={1}>
            {priorityBadge() + ' '}
          </text>
        </Show>
        <text
          fg={selected() ? '#ffffff' : '#cccccc'}
          attributes={selected() ? 1 : 0}
          truncate
        >
          {task().description}
        </text>
      </box>

      {/* Second line: completion date, project */}
      <Show when={metaLine()}>
        <box height={1} width="100%">
          <text fg="#666666" truncate>
            {'  ' + metaLine()}
          </text>
        </box>
      </Show>
    </box>
  );
}
