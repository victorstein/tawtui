import { For, Show } from 'solid-js';
import type { TerminalSession } from '../../terminal.types';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  SEPARATOR_COLOR,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  COLOR_SUCCESS,
  COLOR_ERROR,
} from '../theme';

interface AgentListProps {
  agents: TerminalSession[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
}

/** Status indicator color mapping. */
const STATUS_COLORS: Record<string, string> = {
  running: COLOR_SUCCESS,
  done: FG_DIM,
  failed: COLOR_ERROR,
};

/** Status dot character. */
const STATUS_DOT = '\u25CF';

export function AgentList(props: AgentListProps) {
  const headerText = () => `AGENTS (${props.agents.length})`;

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle={props.isActivePane ? 'double' : 'single'}
      borderColor={props.isActivePane ? ACCENT_PRIMARY : BORDER_DIM}
    >
      {/* Header */}
      <box height={1} width="100%" paddingX={1}>
        <text
          fg={props.isActivePane ? FG_NORMAL : FG_DIM}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg={SEPARATOR_COLOR} truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Agent list — <For> handles its own cleanup; empty state is separate
           to avoid @opentui <Show> not properly removing <For> items on transition. */}
      <scrollbox flexGrow={1} width="100%">
        <For each={props.agents}>
          {(agent, index) => {
            const isSelected = () =>
              props.isActivePane && index() === props.selectedIndex;
            const statusColor = () => STATUS_COLORS[agent.status] ?? FG_DIM;

            /** Build the metadata line (PR or task association). */
            const metaText = () => {
              const parts: string[] = [];
              if (agent.prNumber != null) {
                parts.push(`PR #${agent.prNumber}`);
              }
              if (agent.taskUuid) {
                parts.push(`task:${agent.taskUuid.slice(0, 8)}`);
              }
              return parts.length > 0 ? parts.join(' | ') : null;
            };

            return (
              <box
                width="100%"
                flexDirection="column"
                backgroundColor={isSelected() ? BG_SELECTED : undefined}
                paddingX={1}
              >
                {/* Line 1: status dot + session name */}
                <box height={1} width="100%" flexDirection="row">
                  <text fg={statusColor()}>{STATUS_DOT} </text>
                  <text
                    fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                    attributes={isSelected() ? 1 : 0}
                    truncate
                  >
                    {agent.name}
                  </text>
                </box>

                {/* Line 2: metadata (PR / task) if present */}
                <Show when={metaText()}>
                  <box height={1} width="100%" paddingX={0}>
                    <text fg={FG_DIM} truncate>
                      {`  ${metaText()}`}
                    </text>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
        {/* Stable container prevents @opentui <Show> node cleanup issues */}
        <box flexDirection="column">
          <Show when={props.agents.length === 0}>
            <box paddingX={1} paddingY={1} flexDirection="column">
              <text fg={FG_DIM}>No agents running</text>
              <box height={1} />
              <text fg={FG_DIM}>Press 'n' to spawn a new agent</text>
            </box>
          </Show>
        </box>
      </scrollbox>
    </box>
  );
}
