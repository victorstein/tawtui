import { For, Show } from 'solid-js';
import type { TerminalSession } from '../../terminal.types';

interface AgentListProps {
  agents: TerminalSession[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
}

/** Status indicator color mapping. */
const STATUS_COLORS: Record<string, string> = {
  running: '#4ecca3',
  done: '#888888',
  failed: '#e94560',
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
      borderColor={props.isActivePane ? '#e94560' : '#333333'}
    >
      {/* Header */}
      <box height={1} width="100%" paddingX={1}>
        <text
          fg={props.isActivePane ? '#e94560' : '#888888'}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg="#333333" truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Agent list */}
      <scrollbox flexGrow={1} width="100%">
        <Show
          when={props.agents.length > 0}
          fallback={
            <box paddingX={1} paddingY={1} flexDirection="column">
              <text fg="#555555">No agents running</text>
              <box height={1} />
              <text fg="#666666">Press 'n' to spawn a new agent</text>
            </box>
          }
        >
          <For each={props.agents}>
            {(agent, index) => {
              const isSelected = () =>
                props.isActivePane && index() === props.selectedIndex;
              const statusColor = () =>
                STATUS_COLORS[agent.status] ?? '#888888';

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
                  backgroundColor={isSelected() ? '#16213e' : undefined}
                  paddingX={1}
                >
                  {/* Line 1: status dot + session name */}
                  <box height={1} width="100%" flexDirection="row">
                    <text fg={statusColor()}>{STATUS_DOT} </text>
                    <text
                      fg={isSelected() ? '#ffffff' : '#cccccc'}
                      attributes={isSelected() ? 1 : 0}
                      truncate
                    >
                      {agent.name}
                    </text>
                  </box>

                  {/* Line 2: metadata (PR / task) if present */}
                  <Show when={metaText()}>
                    <box height={1} width="100%" paddingX={0}>
                      <text fg="#666666" truncate>
                        {`  ${metaText()}`}
                      </text>
                    </box>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
