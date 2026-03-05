import { createEffect, For, Show } from 'solid-js';
import type { ScrollBoxRenderable } from '@opentui/core';
import type { Task } from '../../taskwarrior.types';
import {
  BORDER_DIM,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  ARCHIVE_GRAD,
  COLOR_WARNING,
} from '../theme';
import { lerpHex, darkenHex, LEFT_CAP, RIGHT_CAP } from '../utils';

const DIM_FACTOR = 0.5;

export interface DateGroup {
  date: string;
  label: string;
  tasks: Task[];
}

interface DateListProps {
  dates: DateGroup[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
}

const DATE_ROW_HEIGHT = 1;

export function DateList(props: DateListProps) {
  let scrollRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    const idx = props.selectedIndex;
    if (!scrollRef) return;
    scrollRef.scrollTo(idx * DATE_ROW_HEIGHT);
  });

  const headerLabel = () => ` DATES (${props.dates.length}) `;

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

      {/* Date list */}
      <scrollbox
        ref={(el: ScrollBoxRenderable) => {
          scrollRef = el;
        }}
        flexGrow={1}
        width="100%"
      >
        <Show
          when={props.dates.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No archived dates</text>
            </box>
          }
        >
          <For each={props.dates}>
            {(group, index) => {
              const isCurrent = () => index() === props.selectedIndex;
              const isActive = () => isCurrent() && props.isActivePane;
              return (
                <box
                  width="100%"
                  paddingX={1}
                  backgroundColor={isCurrent() ? BG_SELECTED : undefined}
                  flexDirection="row"
                >
                  {/* Selection indicator */}
                  <text fg={isActive() ? FG_PRIMARY : FG_DIM}>
                    {isCurrent() ? '\u25CF ' : '  '}
                  </text>
                  {/* Date label */}
                  <text
                    fg={isActive() ? FG_PRIMARY : FG_NORMAL}
                    attributes={isActive() ? 1 : 0}
                    truncate
                  >
                    {group.label}
                  </text>
                  {/* Task count badge */}
                  <text fg={COLOR_WARNING}>{` (${group.tasks.length})`}</text>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}

export default DateList;
