import { createSignal, createEffect, onMount, Show } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { Task, CreateTaskDto } from '../../taskwarrior.types';
import type { TaskwarriorService } from '../../taskwarrior.service';
import { BoardColumn } from '../components/board-column';
import { TaskForm } from '../components/task-form';
import { TaskDetail } from '../components/task-detail';
import { FilterBar } from '../components/filter-bar';
import { ArchiveView } from '../components/archive-view';
import { useDialog } from '../context/dialog';
import {
  BG_BASE,
  FG_DIM,
  ACCENT_PRIMARY,
  ACCENT_SECONDARY,
  COLOR_ERROR,
} from '../theme';

/** Column definitions for the kanban board. */
const COLUMNS = ['TODO', 'IN PROGRESS', 'DONE'] as const;

const DIALOG_GRAD_START = '#5a7aaa';
const DIALOG_GRAD_END = '#2a4a7a';

/**
 * Access the TaskwarriorService bridged from NestJS DI via globalThis.
 * The TuiService sets this before rendering.
 */
function getTaskwarriorService(): TaskwarriorService | null {
  return (globalThis as any).__tawtui?.taskwarriorService ?? null;
}

/**
 * Categorise a flat list of tasks into the three kanban columns.
 *
 *  - TODO:        status:pending and no `start` timestamp (not ACTIVE)
 *  - IN PROGRESS: status:pending and has a `start` timestamp (ACTIVE)
 *  - DONE:        status:completed with `end` date >= today midnight
 */
function categoriseTasks(tasks: Task[]): [Task[], Task[], Task[]] {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const todo: Task[] = [];
  const inProgress: Task[] = [];
  const done: Task[] = [];

  for (const t of tasks) {
    if (t.status === 'pending') {
      if (t.start) {
        inProgress.push(t);
      } else {
        todo.push(t);
      }
    } else if (t.status === 'completed' && t.end) {
      // Parse taskwarrior date format: "20260214T120000Z"
      try {
        const y = t.end.slice(0, 4);
        const m = t.end.slice(4, 6);
        const d = t.end.slice(6, 8);
        const endDate = new Date(`${y}-${m}-${d}`);
        if (endDate >= todayMidnight) {
          done.push(t);
        }
      } catch {
        // Skip tasks with unparseable end dates
      }
    }
  }

  // Sort by urgency descending within each column
  const byUrgency = (a: Task, b: Task) =>
    (b.urgency ?? 0) - (a.urgency ?? 0);
  todo.sort(byUrgency);
  inProgress.sort(byUrgency);
  done.sort(byUrgency);

  return [todo, inProgress, done];
}

interface TasksViewProps {
  onArchiveModeChange?: (active: boolean) => void;
  onInputCapturedChange?: (captured: boolean) => void;
}

export function TasksView(props: TasksViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  // Board state
  const [activeColumn, setActiveColumn] = createSignal(0);
  const [selectedIndices, setSelectedIndices] = createSignal<
    [number, number, number]
  >([0, 0, 0]);

  // Task data per column
  const [todoTasks, setTodoTasks] = createSignal<Task[]>([]);
  const [inProgressTasks, setInProgressTasks] = createSignal<Task[]>([]);
  const [doneTasks, setDoneTasks] = createSignal<Task[]>([]);

  // Loading / error state
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Filter state
  const [filterActive, setFilterActive] = createSignal(false);
  const [filterText, setFilterText] = createSignal('');
  const [appliedFilter, setAppliedFilter] = createSignal('');

  // Archive mode: toggles between kanban board and archive sub-view
  const [archiveMode, setArchiveMode] = createSignal(false);

  // Notify parent when archive mode changes
  createEffect(() => {
    const active = archiveMode();
    props.onArchiveModeChange?.(active);
  });

  // Notify parent when filter bar captures input
  createEffect(() => {
    props.onInputCapturedChange?.(filterActive());
  });

  /** Fetch tasks from the TaskwarriorService and populate columns. */
  async function loadTasks(): Promise<void> {
    const tw = getTaskwarriorService();
    if (!tw) {
      setError('TaskwarriorService not available');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build filter strings, appending user filter if active
      const userFilter = appliedFilter().trim();
      const pendingFilter = userFilter
        ? `status:pending ${userFilter}`
        : 'status:pending';
      const completedFilter = userFilter
        ? `status:completed end.after:today ${userFilter}`
        : 'status:completed end.after:today';

      // Fetch pending and recently-completed tasks in parallel.
      const [pending, completed] = await Promise.all([
        tw.getTasks(pendingFilter),
        tw.getTasks(completedFilter),
      ]);

      const allTasks = [...pending, ...completed];
      const [todo, ip, dn] = categoriseTasks(allTasks);

      setTodoTasks(todo);
      setInProgressTasks(ip);
      setDoneTasks(dn);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load tasks',
      );
    } finally {
      setLoading(false);
    }
  }

  /** Helper: get the task list for a column index. */
  function tasksForColumn(col: number): Task[] {
    if (col === 0) return todoTasks();
    if (col === 1) return inProgressTasks();
    return doneTasks();
  }

  /** Clamp the selected index for a column after data changes. */
  function clampIndex(col: number): void {
    const tasks = tasksForColumn(col);
    const indices = [...selectedIndices()] as [number, number, number];
    const clamped = Math.max(Math.min(indices[col], tasks.length - 1), 0);
    if (clamped !== indices[col]) {
      indices[col] = clamped;
      setSelectedIndices(indices);
    }
  }

  // Clamp indices whenever task data changes
  createEffect(() => {
    todoTasks();
    inProgressTasks();
    doneTasks();
    clampIndex(0);
    clampIndex(1);
    clampIndex(2);
  });

  /** Get the currently focused task (if any). */
  function selectedTask(): Task | null {
    const col = activeColumn();
    const tasks = tasksForColumn(col);
    const idx = selectedIndices()[col];
    return tasks[idx] ?? null;
  }

  /** Execute a task action and refresh. */
  async function taskAction(
    action: (uuid: string) => Promise<void>,
    task: Task | null,
  ): Promise<void> {
    if (!task) return;
    const tw = getTaskwarriorService();
    if (!tw) return;

    try {
      await action.call(tw, task.uuid);
      await loadTasks();
    } catch {
      // Silently ignore errors for now; the refresh will show current state
      await loadTasks();
    }
  }

  // Keyboard navigation
  useKeyboard((key) => {
    // Don't handle keys when a dialog is open
    if (dialog.isOpen()) return;

    // Don't handle board keys when filter is active (FilterBar owns input)
    if (filterActive()) return;

    // Toggle archive mode with Shift+A
    if (key.name === 'A' || (key.name === 'a' && key.shift)) {
      setArchiveMode((prev) => !prev);
      return;
    }

    // When in archive mode, don't handle kanban board keys
    // (ArchiveView has its own keyboard handler)
    if (archiveMode()) return;

    // Toggle filter mode with `/`
    if (key.name === '/') {
      setFilterActive(true);
      return;
    }

    // Column navigation
    if (key.name === 'h' || key.name === 'left') {
      setActiveColumn((c) => Math.max(c - 1, 0));
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      setActiveColumn((c) => Math.min(c + 1, 2));
      return;
    }

    // Within-column navigation
    if (key.name === 'j' || key.name === 'down') {
      const col = activeColumn();
      const maxIdx = tasksForColumn(col).length - 1;
      const indices = [...selectedIndices()] as [number, number, number];
      indices[col] = Math.min(indices[col] + 1, Math.max(maxIdx, 0));
      setSelectedIndices(indices);
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      const col = activeColumn();
      const indices = [...selectedIndices()] as [number, number, number];
      indices[col] = Math.max(indices[col] - 1, 0);
      setSelectedIndices(indices);
      return;
    }

    // Start task: move from TODO -> IN PROGRESS
    if (key.name === 's' && !key.shift) {
      const task = selectedTask();
      if (task && activeColumn() === 0) {
        taskAction((uuid) => getTaskwarriorService()!.startTask(uuid), task);
      }
      return;
    }

    // Stop task: move from IN PROGRESS -> TODO
    if (key.name === 's' && key.shift) {
      const task = selectedTask();
      if (task && activeColumn() === 1) {
        taskAction((uuid) => getTaskwarriorService()!.stopTask(uuid), task);
      }
      return;
    }

    // Complete task: move to DONE
    if (key.name === 'd' && !key.shift) {
      const task = selectedTask();
      if (task && (activeColumn() === 0 || activeColumn() === 1)) {
        taskAction((uuid) => getTaskwarriorService()!.completeTask(uuid), task);
      }
      return;
    }

    // New task
    if (key.name === 'n') {
      key.preventDefault();
      dialog.show(
        () => (
          <TaskForm
            mode="create"
            onSubmit={async (dto: CreateTaskDto) => {
              const tw = getTaskwarriorService();
              if (tw) {
                try {
                  await tw.createTask(dto);
                } catch {
                  // Ignore creation errors; refresh will show current state
                }
                await loadTasks();
              }
              dialog.close();
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'large', gradStart: DIALOG_GRAD_START, gradEnd: DIALOG_GRAD_END },
      );
      return;
    }

    // View task detail
    if (key.name === 'return') {
      const task = selectedTask();
      if (!task) return;
      dialog.show(
        () => (
          <TaskDetail
            task={task}
            onEdit={() => {
              dialog.close();
              dialog.show(
                () => (
                  <TaskForm
                    mode="edit"
                    initialValues={{
                      description: task.description,
                      annotation: task.annotations?.[0]?.description,
                      project: task.project,
                      priority: task.priority,
                      tags: task.tags,
                      due: task.due,
                    }}
                    onSubmit={async (dto: CreateTaskDto) => {
                      const tw = getTaskwarriorService();
                      if (tw) {
                        try {
                          await tw.updateTask(task.uuid, dto);
                        } catch {
                          // Ignore update errors; refresh will show current state
                        }
                        await loadTasks();
                      }
                      dialog.close();
                    }}
                    onCancel={() => dialog.close()}
                  />
                ),
                { size: 'large', gradStart: DIALOG_GRAD_START, gradEnd: DIALOG_GRAD_END },
              );
            }}
            onClose={() => dialog.close()}
          />
        ),
        { size: 'large', gradStart: DIALOG_GRAD_START, gradEnd: DIALOG_GRAD_END },
      );
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadTasks();
      return;
    }
  });

  // Initial data load
  onMount(() => {
    loadTasks();
  });

  // Calculate column width from terminal dimensions.
  // Each column gets roughly 1/3 of the available width.
  const columnWidth = () => {
    const termWidth = dimensions().width;
    return Math.floor(termWidth / 3);
  };

  /** Handler: apply the filter text and reload tasks. */
  function handleFilterApply(text: string): void {
    setAppliedFilter(text);
    setFilterActive(false);
    loadTasks();
  }

  /** Handler: clear the filter and reload all tasks. */
  function handleFilterClear(): void {
    setFilterText('');
    setAppliedFilter('');
    setFilterActive(false);
    loadTasks();
  }

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {/* Archive sub-view (replaces kanban board when active) */}
      <Show when={archiveMode()}>
        <ArchiveView isActive={() => archiveMode()} />
      </Show>

      {/* Normal kanban board view */}
      <Show when={!archiveMode()}>
        {/* Filter bar — shown when filter mode is active */}
        <Show when={filterActive()}>
          <FilterBar
            filterText={filterText()}
            onFilterTextChange={(val) => setFilterText(val)}
            onApply={handleFilterApply}
            onClear={handleFilterClear}
            focused={filterActive()}
          />
        </Show>

        {/* Active filter indicator — shown when a filter is applied but bar is closed */}
        <Show when={!filterActive() && appliedFilter().trim()}>
          <box height={1} width="100%" paddingX={1} backgroundColor={BG_BASE}>
            <text fg={ACCENT_PRIMARY} attributes={1}>{'Filter: '}</text>
            <text fg={ACCENT_SECONDARY}>{appliedFilter()}</text>
            <text fg={FG_DIM}>{'  (press / to edit, Esc in filter to clear)'}</text>
          </box>
        </Show>

        {/* Loading indicator */}
        <Show when={loading() && !todoTasks().length && !inProgressTasks().length}>
          <box height={1} paddingX={1}>
            <text fg={FG_DIM}>Loading tasks...</text>
          </box>
        </Show>

        {/* Error message */}
        <Show when={error()}>
          <box height={1} paddingX={1}>
            <text fg={COLOR_ERROR}>Error: {error()}</text>
          </box>
        </Show>

        {/* Kanban board: three columns side by side */}
        <box flexDirection="row" flexGrow={1} width="100%">
          <BoardColumn
            title={COLUMNS[0]}
            tasks={todoTasks()}
            selectedIndex={selectedIndices()[0]}
            isActiveColumn={activeColumn() === 0}
            width={columnWidth()}
          />
          <BoardColumn
            title={COLUMNS[1]}
            tasks={inProgressTasks()}
            selectedIndex={selectedIndices()[1]}
            isActiveColumn={activeColumn() === 1}
            width={columnWidth()}
          />
          <BoardColumn
            title={COLUMNS[2]}
            tasks={doneTasks()}
            selectedIndex={selectedIndices()[2]}
            isActiveColumn={activeColumn() === 2}
            width={columnWidth()}
          />
        </box>
      </Show>
    </box>
  );
}
