import { For, Show } from 'solid-js';
import type { Task } from '../../taskwarrior.types';
import { TaskCard } from './task-card';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  FG_DIM,
  SEPARATOR_COLOR,
} from '../theme';

const LEFT_CAP = '\uE0B6';
const RIGHT_CAP = '\uE0B4';

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

const COLUMN_GRADIENTS: Record<string, [string, string]> = {
  TODO: ['#8a7aaa', '#445f80'],
  'IN PROGRESS': ['#fc6529', '#d43535'],
  DONE: ['#5aaa6a', '#2a7a8a'],
};
const DEFAULT_GRADIENT: [string, string] = ['#1a4050', '#0e2a3d'];

interface BoardColumnProps {
  title: string;
  tasks: Task[];
  selectedIndex: number;
  isActiveColumn: boolean;
  width: number;
}

export function BoardColumn(props: BoardColumnProps) {
  const headerLabel = () =>
    ` ${props.title} (${props.tasks.length}) `;
  const gradient = () =>
    COLUMN_GRADIENTS[props.title] ?? DEFAULT_GRADIENT;
  const gradStart = () => gradient()[0];
  const gradEnd = () => gradient()[1];

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle={props.isActiveColumn ? 'double' : 'single'}
      borderColor={props.isActiveColumn ? ACCENT_PRIMARY : BORDER_DIM}
    >
      {/* Column header */}
      <box height={1} width="100%" paddingX={1} flexDirection="row">
        <text fg={gradStart()}>{LEFT_CAP}</text>
        <For each={headerLabel().split('')}>
          {(char, i) => {
            const t = () =>
              headerLabel().length > 1
                ? i() / (headerLabel().length - 1)
                : 0;
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

      {/* Separator line */}
      <box height={1} width="100%">
        <text
          fg={props.isActiveColumn ? gradStart() : SEPARATOR_COLOR}
          truncate
        >
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
              <box width="100%" flexDirection="column">
                <TaskCard
                  task={task}
                  isSelected={
                    props.isActiveColumn &&
                    index() === props.selectedIndex
                  }
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
