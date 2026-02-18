import { For, Show } from 'solid-js';
import type { TerminalSession } from '../../terminal.types';
import {
  BORDER_DIM,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  COLOR_SUCCESS,
  COLOR_ERROR,
  AGENT_GRAD,
} from '../theme';
import { lerpHex, darkenHex, LEFT_CAP, RIGHT_CAP } from '../utils';

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
  const headerLabel = () => ` AGENTS (${props.agents.length}) `;

  const DIM_FACTOR = 0.5;
  const gradStart = () => AGENT_GRAD[0];
  const gradEnd = () => AGENT_GRAD[1];

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

      {/* Scrollbox is fully unmounted when empty to avoid @opentui stale node
           bug — process.nextTick cleanup in _removeNode causes <For> children
           to persist visually inside scrollbox even after signal updates. */}
      <Show
        when={props.agents.length > 0}
        fallback={
          <box flexGrow={1} width="100%" paddingX={1} paddingY={1} flexDirection="column">
            <text fg={FG_DIM}>No agents running</text>
            <box height={1} />
            <text fg={FG_DIM}>Press 'n' to spawn a new agent</text>
          </box>
        }
      >
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
                  paddingBottom={1}
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
        </scrollbox>
      </Show>
    </box>
  );
}
