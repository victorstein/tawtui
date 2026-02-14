import { For, Show } from 'solid-js';
import type { Task } from '../../taskwarrior.types';
import { TaskCard } from './task-card';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  FG_NORMAL,
  FG_DIM,
  SEPARATOR_COLOR,
} from '../theme';

interface BoardColumnProps {
  title: string;
  tasks: Task[];
  selectedIndex: number;
  isActiveColumn: boolean;
  width: number;
}

export function BoardColumn(props: BoardColumnProps) {
  const headerText = () => `${props.title} (${props.tasks.length})`;

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle={props.isActiveColumn ? 'double' : 'single'}
      borderColor={props.isActiveColumn ? ACCENT_PRIMARY : BORDER_DIM}
    >
      {/* Column header */}
      <box height={1} width="100%" paddingX={1}>
        <text
          fg={props.isActiveColumn ? FG_NORMAL : FG_DIM}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator line */}
      <box height={1} width="100%">
        <text fg={SEPARATOR_COLOR} truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Scrollable task list */}
      <scrollbox flexGrow={1} width="100%">
        <Show
          when={props.tasks.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No tasks</text>
            </box>
          }
        >
          <For each={props.tasks}>
            {(task, index) => (
              <box
                width="100%"
                flexDirection="column"
              >
                <TaskCard
                  task={task}
                  isSelected={props.isActiveColumn && index() === props.selectedIndex}
                  width={Math.max(props.width - 2, 10)}
                />
                {/* Spacer between cards */}
                <Show when={index() < props.tasks.length - 1}>
                  <box height={1} />
                </Show>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
