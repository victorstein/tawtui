import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { AgentDefinition, ProjectAgentConfig } from '../../config.types';
import {
  BG_INPUT,
  BG_INPUT_FOCUS,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  ACCENT_PRIMARY,
  COLOR_SUCCESS,
  REPO_GRAD,
} from '../theme';
import { darkenHex, lerpHex } from '../utils';

const FORM_BUTTONS = [
  {
    label: ' [Enter] Save ',
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

interface DialogProjectAgentConfigProps {
  projectKey: string;
  onConfirm: (cfg: ProjectAgentConfig) => void;
  onCancel: () => void;
}

const FIELDS = ['agentType', 'autoApprove', 'cwd'] as const;
type FieldName = (typeof FIELDS)[number];

const FIELD_LABELS: Record<FieldName, string> = {
  agentType: 'Agent Type',
  autoApprove: 'Auto-approve',
  cwd: 'Working Dir',
};

export function DialogProjectAgentConfig(props: DialogProjectAgentConfigProps) {
  const [ready, setReady] = createSignal(false);
  const [focusedField, setFocusedField] = createSignal<number>(0);

  // Agent type select
  const [agentTypes, setAgentTypes] = createSignal<AgentDefinition[]>([]);
  const [agentCursor, setAgentCursor] = createSignal(0);

  // Auto-approve toggle
  const [autoApprove, setAutoApprove] = createSignal(false);

  // Working directory text input
  const [cwd, setCwd] = createSignal('');

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

    const configService = (globalThis as Record<string, unknown>).__tawtui as
      | Record<string, unknown>
      | undefined;
    if (!configService) return;

    const svc = configService.configService as
      | {
          getAgentTypes: () => AgentDefinition[];
          getProjectAgentConfig: (key: string) => ProjectAgentConfig | null;
        }
      | undefined;
    if (!svc) return;

    // Load agent types
    try {
      const types = svc.getAgentTypes();
      setAgentTypes(types);

      // Load existing project config and pre-populate
      const existing = svc.getProjectAgentConfig(props.projectKey);
      if (existing) {
        const idx = types.findIndex((t) => t.id === existing.agentTypeId);
        if (idx >= 0) {
          setAgentCursor(idx);
        }
        setAutoApprove(existing.autoApprove);
        setCwd(existing.cwd ?? '');
      }
    } catch {
      // Silently fail — will show empty list
    }
  });

  const handleSubmit = () => {
    const agent = selectedAgent();
    if (!agent) return;

    props.onConfirm({
      projectKey: props.projectKey,
      agentTypeId: agent.id,
      autoApprove: autoApprove(),
      cwd: cwd().trim() || undefined,
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

    // Auto-approve toggle
    if (currentField() === 'autoApprove') {
      if (key.name === 'space') {
        key.preventDefault();
        key.stopPropagation();
        setAutoApprove((prev) => !prev);
        return;
      }
    }

    // cwd field — handled by <input> component, no extra handling needed
  });

  const labelColor = (idx: number) =>
    buttonFocus() === null && focusedField() === idx ? FG_NORMAL : FG_DIM;

  const isFieldFocused = (idx: number) =>
    buttonFocus() === null && focusedField() === idx;

  /** Get the visible field index for a given field name. */
  const fieldIndex = (fieldName: FieldName): number =>
    visibleFields().indexOf(fieldName);

  // Gradient title pill text
  const titleText = () => `Configure Agent \u00B7 ${props.projectKey}`;

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title — gradient pill with REPO_GRAD */}
      <box height={1} flexDirection="row">
        <text fg={REPO_GRAD[0]}>{'\uE0B6'}</text>
        <For each={titleText().split('')}>
          {(char, i) => {
            const t = () =>
              titleText().length > 1 ? i() / (titleText().length - 1) : 0;
            return (
              <text
                fg="#ffffff"
                bg={lerpHex(REPO_GRAD[0], REPO_GRAD[1], t())}
                attributes={1}
              >
                {char}
              </text>
            );
          }}
        </For>
        <text fg={REPO_GRAD[1]}>{'\uE0B4'}</text>
      </box>
      <box height={1} />

      {/* Agent Type field — vertical select list */}
      <box flexDirection="row">
        <box width={16} height={1}>
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
          <box flexDirection="column" width={56}>
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

      {/* Auto-approve field — wrapped in a stable container to prevent
           <Show> from appending nodes at the end of the parent layout. */}
      <box flexDirection="column">
        <Show when={hasAutoApproveFlag()}>
          <box flexDirection="row">
            <box width={16} height={1}>
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
              <box flexDirection="column" width={56}>
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

      {/* CWD field — text input */}
      <box height={1} flexDirection="row">
        <box width={16}>
          <text
            fg={labelColor(fieldIndex('cwd'))}
            attributes={isFieldFocused(fieldIndex('cwd')) ? 1 : 0}
          >
            {isFieldFocused(fieldIndex('cwd')) ? '> ' : '  '}
            {FIELD_LABELS.cwd}
          </text>
        </box>
        <input
          width={56}
          value={cwd()}
          placeholder="(default: process.cwd())"
          focused={isFieldFocused(fieldIndex('cwd'))}
          backgroundColor={
            isFieldFocused(fieldIndex('cwd')) ? BG_INPUT_FOCUS : BG_INPUT
          }
          textColor={FG_NORMAL}
          onInput={(val: string) => setCwd(val)}
        />
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Key hints */}
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
