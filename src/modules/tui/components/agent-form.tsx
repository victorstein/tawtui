import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { AgentDefinition } from '../../config.types';
import type { Task } from '../../taskwarrior.types';
import {
  BG_INPUT,
  BG_INPUT_FOCUS,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  ACCENT_PRIMARY,
  COLOR_SUCCESS,
  COLOR_ERROR,
} from '../theme';
import { darkenHex, lerpHex } from '../utils';
import { getConfigService, getTaskwarriorService } from '../bridge';

const FORM_BUTTONS = [
  {
    label: ' [Enter] Create ',
    shortcut: 'return',
    gradStart: '#5aaa6a',
    gradEnd: '#2a7a8a',
  },
  {
    label: ' [Esc] Cancel ',
    shortcut: 'escape',
    gradStart: '#e05555',
    gradEnd: '#8a2a2a',
  },
] as const;

interface AgentFormProps {
  onSubmit: (data: {
    name: string;
    command: string;
    taskUuid?: string;
  }) => void;
  onCancel: () => void;
}

const FIELDS = ['name', 'agentType', 'linkTask', 'autoApprove'] as const;
type FieldName = (typeof FIELDS)[number];

const FIELD_LABELS: Record<FieldName, string> = {
  name: 'Name',
  agentType: 'Agent Type',
  linkTask: 'Link Task',
  autoApprove: 'Auto-approve',
};

export function AgentForm(props: AgentFormProps) {
  const [ready, setReady] = createSignal(false);
  const [focusedField, setFocusedField] = createSignal<number>(0);
  const [name, setName] = createSignal('');

  // Agent type select
  const [agentTypes, setAgentTypes] = createSignal<AgentDefinition[]>([]);
  const [agentCursor, setAgentCursor] = createSignal(0);

  // Task linking
  const [pendingTasks, setPendingTasks] = createSignal<Task[]>([]);
  const [taskCursor, setTaskCursor] = createSignal(-1); // -1 means "None" selected
  const [taskFilter, setTaskFilter] = createSignal('');

  // Auto-approve toggle
  const [autoApprove, setAutoApprove] = createSignal(false);

  // Button row focus
  const [buttonFocus, setButtonFocus] = createSignal<number | null>(null);

  const selectedAgent = (): AgentDefinition | undefined =>
    agentTypes()[agentCursor()];

  const hasAutoApproveFlag = (): boolean => !!selectedAgent()?.autoApproveFlag;

  /** Compute visible field count: hide auto-approve when agent has no flag. */
  const visibleFields = (): FieldName[] => {
    if (hasAutoApproveFlag()) return [...FIELDS];
    return FIELDS.filter((f) => f !== 'autoApprove');
  };

  const currentField = (): FieldName => visibleFields()[focusedField()];

  /** Filtered pending tasks based on user search text. */
  const filteredTasks = (): Task[] => {
    const filter = taskFilter().toLowerCase();
    if (!filter) return pendingTasks();
    return pendingTasks().filter(
      (t) =>
        t.description.toLowerCase().includes(filter) ||
        (t.project?.toLowerCase().includes(filter) ?? false),
    );
  };

  // Auto-populate name when agent type changes
  createEffect(() => {
    const agent = selectedAgent();
    if (agent) {
      setName(agent.label);
    }
  });

  // Reset auto-approve when switching to an agent without the flag
  createEffect(() => {
    if (!hasAutoApproveFlag()) {
      setAutoApprove(false);
    }
  });

  // Clamp focused field when visible fields change
  createEffect(() => {
    const maxIdx = visibleFields().length - 1;
    if (focusedField() > maxIdx) {
      setFocusedField(maxIdx);
    }
  });

  onMount(async () => {
    // Delay input readiness by one tick to avoid capturing the keystroke that opened the dialog
    setTimeout(() => setReady(true), 0);

    // Load agent types
    const configService = getConfigService();
    if (configService) {
      try {
        const types = configService.getAgentTypes() as AgentDefinition[];
        setAgentTypes(types);
        if (types.length > 0) {
          setName(types[0].label);
        }
      } catch {
        // Silently fail — will show empty list
      }
    }

    // Load pending tasks
    const tw = getTaskwarriorService();
    if (tw) {
      try {
        const tasks = await (tw.getTasks('status:pending') as Promise<Task[]>);
        setPendingTasks(tasks);
      } catch {
        // Silently fail — will show empty list
      }
    }
  });

  const handleSubmit = () => {
    const trimmedName = name().trim();
    if (!trimmedName) return;

    const agent = selectedAgent();
    let command = '';
    if (agent && agent.command) {
      command = agent.command;
      if (autoApprove() && agent.autoApproveFlag) {
        command += ' ' + agent.autoApproveFlag;
      }
    }

    const tasks = filteredTasks();
    const taskIdx = taskCursor();
    const linkedTask =
      taskIdx >= 0 && taskIdx < tasks.length ? tasks[taskIdx] : undefined;

    props.onSubmit({
      name: trimmedName,
      command,
      taskUuid: linkedTask?.uuid,
    });
  };

  useKeyboard((key) => {
    if (!ready()) return;

    // Escape always cancels
    if (key.name === 'escape') {
      key.preventDefault();
      key.stopPropagation();
      props.onCancel();
      return;
    }

    // Ctrl+Enter submits from anywhere
    if (key.name === 'return' && key.ctrl) {
      key.preventDefault();
      key.stopPropagation();
      handleSubmit();
      return;
    }

    // Button row focus handling
    if (buttonFocus() !== null) {
      if (key.name === 'left') {
        key.preventDefault();
        key.stopPropagation();
        setButtonFocus((prev) =>
          prev !== null
            ? (prev - 1 + FORM_BUTTONS.length) % FORM_BUTTONS.length
            : 0,
        );
        return;
      }
      if (key.name === 'right') {
        key.preventDefault();
        key.stopPropagation();
        setButtonFocus((prev) =>
          prev !== null ? (prev + 1) % FORM_BUTTONS.length : 0,
        );
        return;
      }
      if (key.name === 'tab' && !key.shift) {
        key.preventDefault();
        key.stopPropagation();
        if (buttonFocus()! < FORM_BUTTONS.length - 1) {
          setButtonFocus((prev) => prev! + 1);
        } else {
          setButtonFocus(null);
          setFocusedField(0);
        }
        return;
      }
      if (key.name === 'tab' && key.shift) {
        key.preventDefault();
        key.stopPropagation();
        if (buttonFocus()! > 0) {
          setButtonFocus((prev) => prev! - 1);
        } else {
          setButtonFocus(null);
          setFocusedField(visibleFields().length - 1);
        }
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        key.stopPropagation();
        const btn = FORM_BUTTONS[buttonFocus()!];
        if (btn.shortcut === 'return') handleSubmit();
        if (btn.shortcut === 'escape') props.onCancel();
        return;
      }
      key.stopPropagation();
      return;
    }

    // Form field navigation
    if (key.name === 'tab' && !key.shift) {
      key.preventDefault();
      key.stopPropagation();
      if (focusedField() === visibleFields().length - 1) {
        setButtonFocus(0);
      } else {
        setFocusedField((prev) => prev + 1);
      }
      return;
    }
    if (key.name === 'tab' && key.shift) {
      key.preventDefault();
      key.stopPropagation();
      if (focusedField() === 0) {
        setButtonFocus(FORM_BUTTONS.length - 1);
      } else {
        setFocusedField((prev) => prev - 1);
      }
      return;
    }

    // Agent type vertical select (j/k navigation)
    if (currentField() === 'agentType') {
      if (key.name === 'j' || key.name === 'down') {
        key.preventDefault();
        key.stopPropagation();
        setAgentCursor((prev) =>
          prev < agentTypes().length - 1 ? prev + 1 : prev,
        );
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        key.preventDefault();
        key.stopPropagation();
        setAgentCursor((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }
    }

    // Link task field (j/k navigation, typing to filter)
    if (currentField() === 'linkTask') {
      const tasks = filteredTasks();
      if (key.name === 'j' || key.name === 'down') {
        key.preventDefault();
        key.stopPropagation();
        setTaskCursor((prev) => (prev < tasks.length - 1 ? prev + 1 : prev));
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        key.preventDefault();
        key.stopPropagation();
        setTaskCursor((prev) => (prev > -1 ? prev - 1 : prev));
        return;
      }
      if (key.name === 'backspace') {
        key.preventDefault();
        key.stopPropagation();
        setTaskFilter((prev) => prev.slice(0, -1));
        setTaskCursor(-1);
        return;
      }
      // Printable character for filtering
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        key.preventDefault();
        key.stopPropagation();
        setTaskFilter((prev) => prev + key.sequence);
        setTaskCursor(-1);
        return;
      }
    }

    // Auto-approve toggle
    if (currentField() === 'autoApprove') {
      if (key.name === 'space') {
        key.preventDefault();
        key.stopPropagation();
        setAutoApprove((prev) => !prev);
        return;
      }
    }
  });

  const labelColor = (idx: number) =>
    buttonFocus() === null && focusedField() === idx ? FG_NORMAL : FG_DIM;

  const isFieldFocused = (idx: number) =>
    buttonFocus() === null && focusedField() === idx;

  /** Get the visible field index for a given field name. */
  const fieldIndex = (fieldName: FieldName): number =>
    visibleFields().indexOf(fieldName);

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <box height={1}>
        <text fg={FG_PRIMARY} attributes={1}>
          New Agent
        </text>
      </box>
      <box height={1} />

      {/* Name field */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text
            fg={labelColor(fieldIndex('name'))}
            attributes={isFieldFocused(fieldIndex('name')) ? 1 : 0}
          >
            {isFieldFocused(fieldIndex('name')) ? '> ' : '  '}
            {FIELD_LABELS.name}
          </text>
        </box>
        <input
          width={60}
          value={name()}
          placeholder="Agent session name"
          focused={isFieldFocused(fieldIndex('name'))}
          backgroundColor={
            isFieldFocused(fieldIndex('name')) ? BG_INPUT_FOCUS : BG_INPUT
          }
          textColor={FG_NORMAL}
          onInput={(val: string) => setName(val)}
        />
      </box>
      <box height={1} />

      {/* Agent Type field — vertical select list */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text
            fg={labelColor(fieldIndex('agentType'))}
            attributes={isFieldFocused(fieldIndex('agentType')) ? 1 : 0}
          >
            {isFieldFocused(fieldIndex('agentType')) ? '> ' : '  '}
            {FIELD_LABELS.agentType}
          </text>
        </box>
        <Show
          when={isFieldFocused(fieldIndex('agentType'))}
          fallback={
            <box height={1}>
              <text fg={selectedAgent() ? FG_NORMAL : FG_DIM}>
                {selectedAgent()?.label ?? 'None'}
              </text>
            </box>
          }
        >
          <box flexDirection="column" width={60}>
            <Show
              when={agentTypes().length > 0}
              fallback={
                <box height={1}>
                  <text fg={FG_DIM}>No agent types configured</text>
                </box>
              }
            >
              <box
                flexDirection="column"
                backgroundColor={BG_INPUT_FOCUS}
                paddingX={1}
              >
                <For each={agentTypes()}>
                  {(agent, index) => {
                    const isSelected = () => agentCursor() === index();
                    return (
                      <box height={1} flexDirection="row">
                        <text fg={isSelected() ? ACCENT_PRIMARY : FG_DIM}>
                          {isSelected() ? '> ' : '  '}
                        </text>
                        <text
                          fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                          attributes={isSelected() ? 1 : 0}
                        >
                          {agent.label}
                        </text>
                        <Show when={agent.command}>
                          <text fg={FG_DIM}> ({agent.command})</text>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </box>
              <box height={1} paddingX={1}>
                <text fg={FG_DIM}>{'[j/k] navigate'}</text>
              </box>
            </Show>
          </box>
        </Show>
      </box>
      <box height={1} />

      {/* Link Task field — search/select from pending tasks */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text
            fg={labelColor(fieldIndex('linkTask'))}
            attributes={isFieldFocused(fieldIndex('linkTask')) ? 1 : 0}
          >
            {isFieldFocused(fieldIndex('linkTask')) ? '> ' : '  '}
            {FIELD_LABELS.linkTask}
          </text>
        </box>
        <Show
          when={isFieldFocused(fieldIndex('linkTask'))}
          fallback={
            <box height={1}>
              <text fg={FG_DIM}>
                {(() => {
                  const tasks = filteredTasks();
                  const idx = taskCursor();
                  if (idx >= 0 && idx < tasks.length) {
                    return tasks[idx].description;
                  }
                  return 'None';
                })()}
              </text>
            </box>
          }
        >
          <box flexDirection="column" width={60}>
            {/* Search input */}
            <box
              height={1}
              flexDirection="row"
              backgroundColor={BG_INPUT_FOCUS}
              paddingX={1}
            >
              <text fg={FG_DIM}>{'/ '}</text>
              <text fg={FG_NORMAL}>{taskFilter() || ''}</text>
              <text fg={FG_MUTED}>
                {taskFilter() ? '' : 'type to filter...'}
              </text>
            </box>
            {/* Task list */}
            <box
              flexDirection="column"
              backgroundColor={BG_INPUT_FOCUS}
              paddingX={1}
            >
              {/* "None" option */}
              <box height={1} flexDirection="row">
                <text fg={taskCursor() === -1 ? ACCENT_PRIMARY : FG_DIM}>
                  {taskCursor() === -1 ? '> ' : '  '}
                </text>
                <text
                  fg={taskCursor() === -1 ? FG_PRIMARY : FG_DIM}
                  attributes={taskCursor() === -1 ? 1 : 0}
                >
                  (none)
                </text>
              </box>
              <For each={filteredTasks().slice(0, 8)}>
                {(task, index) => {
                  const isSelected = () => taskCursor() === index();
                  return (
                    <box height={1} flexDirection="row">
                      <text fg={isSelected() ? ACCENT_PRIMARY : FG_DIM}>
                        {isSelected() ? '> ' : '  '}
                      </text>
                      <text
                        fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                        attributes={isSelected() ? 1 : 0}
                        truncate
                      >
                        {task.description}
                      </text>
                      <Show when={task.project}>
                        <text fg={FG_DIM}> [{task.project}]</text>
                      </Show>
                    </box>
                  );
                }}
              </For>
            </box>
            <box height={1} paddingX={1}>
              <text fg={FG_DIM}>
                {'[j/k] navigate  [type] filter  [backspace] clear'}
              </text>
            </box>
          </box>
        </Show>
      </box>
      <box height={1} />

      {/* Auto-approve field — wrapped in a stable container to prevent
           <Show> from appending nodes at the end of the parent layout. */}
      <box flexDirection="column">
        <Show when={hasAutoApproveFlag()}>
          <box flexDirection="row">
            <box width={14} height={1}>
              <text
                fg={labelColor(fieldIndex('autoApprove'))}
                attributes={isFieldFocused(fieldIndex('autoApprove')) ? 1 : 0}
              >
                {isFieldFocused(fieldIndex('autoApprove')) ? '> ' : '  '}
                {FIELD_LABELS.autoApprove}
              </text>
            </box>
            <Show
              when={isFieldFocused(fieldIndex('autoApprove'))}
              fallback={
                <box height={1}>
                  <text fg={autoApprove() ? COLOR_SUCCESS : FG_DIM}>
                    {autoApprove() ? '[x] Enabled' : '[ ] Disabled'}
                  </text>
                </box>
              }
            >
              <box flexDirection="column" width={60}>
                <box
                  height={1}
                  backgroundColor={BG_INPUT_FOCUS}
                  paddingX={1}
                  flexDirection="row"
                >
                  <text
                    fg={autoApprove() ? COLOR_SUCCESS : FG_NORMAL}
                    attributes={1}
                  >
                    {autoApprove() ? '[x] Enabled' : '[ ] Disabled'}
                  </text>
                  <box flexGrow={1} />
                  <text fg={FG_DIM}>
                    {selectedAgent()?.autoApproveFlag ?? ''}
                  </text>
                </box>
                <box height={1} paddingX={1}>
                  <text fg={FG_DIM}>{'[space] toggle'}</text>
                </box>
              </box>
            </Show>
          </box>
          <box height={1} />
        </Show>
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Validation hint */}
      <Show when={!name().trim()}>
        <box height={1}>
          <text fg={COLOR_ERROR}>{'  * Name is required'}</text>
        </box>
      </Show>

      {/* Key hints */}
      <box height={1} />
      <box height={1} marginLeft={-2}>
        <text fg={FG_MUTED}>{'[Tab] Next field'}</text>
      </box>
      <box height={1} />

      {/* Action buttons */}
      <box height={1} flexDirection="row">
        <For each={[...FORM_BUTTONS]}>
          {(btn, idx) => {
            const isFocused = () => buttonFocus() === idx();
            const chars = btn.label.split('');
            const dimBg = darkenHex(btn.gradStart, 0.3);
            return (
              <>
                {idx() > 0 && <text>{'  '}</text>}
                <box flexDirection="row">
                  {isFocused() ? (
                    <>
                      <text fg={btn.gradStart}>{'\uE0B6'}</text>
                      <For each={chars}>
                        {(char, i) => {
                          const t =
                            chars.length > 1 ? i() / (chars.length - 1) : 0;
                          return (
                            <text
                              fg="#ffffff"
                              bg={lerpHex(btn.gradStart, btn.gradEnd, t)}
                              attributes={1}
                            >
                              {char}
                            </text>
                          );
                        }}
                      </For>
                      <text fg={btn.gradEnd}>{'\uE0B4'}</text>
                    </>
                  ) : (
                    <>
                      <text fg={dimBg}>{'\uE0B6'}</text>
                      <text fg={btn.gradStart} bg={dimBg}>
                        {btn.label}
                      </text>
                      <text fg={dimBg}>{'\uE0B4'}</text>
                    </>
                  )}
                </box>
              </>
            );
          }}
        </For>
      </box>
    </box>
  );
}
