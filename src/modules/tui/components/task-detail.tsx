import { Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { SyntaxStyle } from '@opentui/core';
import type { Task } from '../../taskwarrior.types';
import {
  BG_SELECTED,
  BORDER_DIM,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  ACCENT_PRIMARY,
  ACCENT_SECONDARY,
  COLOR_SUCCESS,
  COLOR_ERROR,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
  SEPARATOR_COLOR,
  TAG_COLORS,
} from '../theme';

interface TaskDetailProps {
  task: Task;
  onEdit: () => void;
  onClose: () => void;
}

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  H: { label: 'High', color: PRIORITY_H },
  M: { label: 'Medium', color: PRIORITY_M },
  L: { label: 'Low', color: PRIORITY_L },
};

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function tagColor(tag: string): string {
  return TAG_COLORS[djb2(tag) % TAG_COLORS.length];
}

function formatTwDate(raw: string): string {
  try {
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    return `${year}-${month}-${day}`;
  } catch {
    return raw;
  }
}

function isOverdue(due: string): boolean {
  try {
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

const annotationSyntaxStyle = SyntaxStyle.fromTheme([
  {
    scope: ['heading'],
    style: { foreground: FG_PRIMARY, bold: true },
  },
  {
    scope: ['emphasis'],
    style: { foreground: FG_NORMAL, italic: true },
  },
  {
    scope: ['strong'],
    style: { foreground: FG_PRIMARY, bold: true },
  },
  {
    scope: ['code'],
    style: { foreground: ACCENT_SECONDARY },
  },
  {
    scope: ['link'],
    style: { foreground: ACCENT_PRIMARY, underline: true },
  },
  {
    scope: ['blockquote'],
    style: { foreground: FG_DIM, italic: true },
  },
  {
    scope: ['list'],
    style: { foreground: FG_NORMAL },
  },
]);

export function TaskDetail(props: TaskDetailProps) {
  useKeyboard((key) => {
    if (key.name === 'e') {
      props.onEdit();
      return;
    }
    if (key.name === 'escape') {
      props.onClose();
      return;
    }
  });

  const task = () => props.task;

  const priorityInfo = () => {
    const p = task().priority;
    if (!p) return null;
    return PRIORITY_LABELS[p] ?? null;
  };

  const annotation = () => {
    const annotations = task().annotations;
    if (annotations && annotations.length > 0) {
      return annotations[0].description;
    }
    return null;
  };

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <box height={1}>
        <text fg={FG_PRIMARY} attributes={1}>
          {task().description}
        </text>
      </box>

      {/* Separator */}
      <box height={1}>
        <text fg={SEPARATOR_COLOR}>{'─'.repeat(60)}</text>
      </box>

      {/* Metadata row: Priority, Tags, Project, Due */}
      <box height={1} flexDirection="row">
        <text fg={FG_DIM}>{'Priority: '}</text>
        <Show
          when={priorityInfo()}
          fallback={<text fg={FG_MUTED}>{'None'}</text>}
        >
          {(info) => (
            <text fg={info().color} attributes={1}>
              {info().label}
            </text>
          )}
        </Show>
        <text fg={SEPARATOR_COLOR}>{'  │  '}</text>
        <text fg={FG_DIM}>{'Project: '}</text>
        <Show
          when={task().project}
          fallback={<text fg={FG_MUTED}>{'None'}</text>}
        >
          <text fg={PROJECT_COLOR} attributes={4}>
            {task().project}
          </text>
        </Show>
      </box>

      {/* Tags */}
      <box height={1} flexDirection="row">
        <text fg={FG_DIM}>{'Tags: '}</text>
        <Show
          when={task().tags && task().tags!.length > 0}
          fallback={<text fg={FG_MUTED}>{'None'}</text>}
        >
          <For each={task().tags}>
            {(tag, index) => (
              <>
                <Show when={index() > 0}>
                  <text fg={FG_MUTED}>{', '}</text>
                </Show>
                <text fg={tagColor(tag)}>{tag}</text>
              </>
            )}
          </For>
        </Show>
      </box>

      {/* Due date */}
      <box height={1} flexDirection="row">
        <text fg={FG_DIM}>{'Due: '}</text>
        <Show when={task().due} fallback={<text fg={FG_MUTED}>{'None'}</text>}>
          <text fg={isOverdue(task().due!) ? COLOR_ERROR : FG_NORMAL}>
            {formatTwDate(task().due!)}
          </text>
          <Show when={isOverdue(task().due!)}>
            <text fg={COLOR_ERROR} attributes={1}>
              {' OVERDUE'}
            </text>
          </Show>
        </Show>
      </box>

      <box height={1} />

      {/* Status, UUID, Created, Modified */}
      <box height={1} flexDirection="row">
        <text fg={FG_DIM}>{'Status: '}</text>
        <text fg={FG_NORMAL}>{task().status}</text>
        <text fg={SEPARATOR_COLOR}>{'  │  '}</text>
        <text fg={FG_DIM}>{'UUID: '}</text>
        <text fg={FG_MUTED}>{task().uuid.slice(0, 8)}</text>
      </box>

      <box height={1} flexDirection="row">
        <Show when={task().entry}>
          <text fg={FG_DIM}>{'Created: '}</text>
          <text fg={FG_NORMAL}>{formatTwDate(task().entry!)}</text>
        </Show>
        <Show when={task().modified}>
          <text fg={SEPARATOR_COLOR}>{'  │  '}</text>
          <text fg={FG_DIM}>{'Modified: '}</text>
          <text fg={FG_NORMAL}>{formatTwDate(task().modified!)}</text>
        </Show>
      </box>

      {/* Separator */}
      <box height={1}>
        <text fg={SEPARATOR_COLOR}>{'─'.repeat(60)}</text>
      </box>

      {/* Description */}
      <box height={1}>
        <text fg={ACCENT_SECONDARY} attributes={1}>
          {'Description'}
        </text>
      </box>
      <box height={1} />
      <box paddingX={1}>
        <Show
          when={annotation()}
          fallback={<text fg={FG_MUTED}>{'No description'}</text>}
        >
          <markdown
            content={annotation()!}
            syntaxStyle={annotationSyntaxStyle}
          />
        </Show>
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Footer keybindings */}
      <box flexDirection="row" gap={1}>
        <box
          border={true}
          borderStyle="rounded"
          borderColor={BORDER_DIM}
          backgroundColor={BG_SELECTED}
          paddingX={3}
        >
          <text fg={COLOR_SUCCESS} attributes={1}>
            {'e '}
          </text>
          <text fg={FG_PRIMARY}>{'Edit'}</text>
        </box>
        <box
          border={true}
          borderStyle="rounded"
          borderColor={BORDER_DIM}
          backgroundColor={BG_SELECTED}
          paddingX={3}
        >
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'Esc '}
          </text>
          <text fg={FG_PRIMARY}>{'Close'}</text>
        </box>
      </box>
    </box>
  );
}
