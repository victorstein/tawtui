import { For, Show, createEffect } from 'solid-js';
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core';
import type { Task } from '../../taskwarrior.types';
import { TaskCard } from './task-card';
import { BORDER_DIM, FG_DIM } from '../theme';
import { lerpHex, darkenHex, LEFT_CAP, RIGHT_CAP, computeScrollTop } from '../utils';

const COLUMN_GRADIENTS: Record<string, [string, string]> = {
  TODO: ['#8a7aaa', '#445f80'],
  'IN PROGRESS': ['#fc6529', '#d43535'],
  DONE: ['#5aaa6a', '#2a7a8a'],
};
const DEFAULT_GRADIENT: [string, string] = ['#1a4050', '#0e2a3d'];

const DIM_FACTOR = 0.5;

interface BoardColumnProps {
  title: string;
  tasks: Task[];
  selectedIndex: number;
  isActiveColumn: boolean;
  width: number;
}

export function BoardColumn(props: BoardColumnProps) {
  let scrollRef: ScrollBoxRenderable | undefined;
  const cardRefs: (BoxRenderable | undefined)[] = [];

  createEffect(() => {
    const idx = props.selectedIndex;
    if (!props.isActiveColumn) return;
    if (!scrollRef) return;
    const sb = scrollRef;
    if (sb.viewport.height <= 0) return;

    const card = cardRefs[idx];
    if (!card) return;

    const itemTop = card.y - sb.content.y;
    const itemBottom = itemTop + card.height;

    const next = computeScrollTop({
      itemTop,
      itemBottom,
      viewTop: sb.scrollTop,
      viewHeight: sb.viewport.height,
    });
    if (next !== null) sb.scrollTo(next);
  });

  const headerLabel = () => ` ${props.title} (${props.tasks.length}) `;
  const gradient = () => COLUMN_GRADIENTS[props.title] ?? DEFAULT_GRADIENT;
  const gradStart = () => gradient()[0];
  const gradEnd = () => gradient()[1];

  const colorStart = () =>
    props.isActiveColumn ? gradStart() : darkenHex(gradStart(), DIM_FACTOR);
  const colorEnd = () =>
    props.isActiveColumn ? gradEnd() : darkenHex(gradEnd(), DIM_FACTOR);

  const innerWidth = () => Math.max(props.width - 2, 1);

  const borderColor = () =>
    props.isActiveColumn ? lerpHex(gradStart(), gradEnd(), 0.5) : BORDER_DIM;

  return (
    <box
      flexDirection="column"
      width={props.width}
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

      {/* Column header */}
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

      {/* Scrollable task list */}
      <Show
        when={props.tasks.length > 0}
        fallback={
          <box flexGrow={1} width="100%" paddingX={1} paddingY={1}>
            <text fg={FG_DIM}>No tasks</text>
          </box>
        }
      >
        <scrollbox
          ref={(el: ScrollBoxRenderable) => {
            scrollRef = el;
          }}
          flexGrow={1}
          width="100%"
        >
          <For each={props.tasks}>
            {(task, index) => (
              <box
                ref={(el: BoxRenderable) => {
                  cardRefs[index()] = el;
                }}
                width="100%"
                flexDirection="column"
              >
                <TaskCard
                  task={task}
                  isSelected={
                    props.isActiveColumn && index() === props.selectedIndex
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
        </scrollbox>
      </Show>
    </box>
  );
}
