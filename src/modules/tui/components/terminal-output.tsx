import { Show } from 'solid-js';
import type { CaptureResult } from '../../terminal.types';

interface TerminalOutputProps {
  capture: CaptureResult | null;
  isActivePane: boolean;
  isInteractive: boolean;
  agentName: string | null;
}

export function TerminalOutput(props: TerminalOutputProps) {
  const headerText = () => {
    if (props.isInteractive) {
      return 'INTERACTIVE MODE - ESC to exit';
    }
    if (props.agentName) {
      return `OUTPUT: ${props.agentName}`;
    }
    return 'TERMINAL OUTPUT';
  };

  const headerColor = () => {
    if (props.isInteractive) return '#e94560';
    if (props.isActivePane) return '#e94560';
    return '#888888';
  };

  const borderColor = () => {
    if (props.isInteractive) return '#e94560';
    if (props.isActivePane) return '#e94560';
    return '#333333';
  };

  const borderStyle = () => {
    if (props.isInteractive) return 'double';
    if (props.isActivePane) return 'double';
    return 'single';
  };

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      height="100%"
      borderStyle={borderStyle()}
      borderColor={borderColor()}
    >
      {/* Header */}
      <box height={1} width="100%" paddingX={1} flexDirection="row">
        <text
          fg={headerColor()}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg={props.isInteractive ? '#e94560' : '#333333'} truncate>
          {props.isInteractive
            ? '\u2550'.repeat(200)
            : '\u2500'.repeat(200)}
        </text>
      </box>

      {/* Content area */}
      <box flexGrow={1} width="100%" flexDirection="column">
        <Show
          when={props.agentName}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg="#555555">No agent selected</text>
            </box>
          }
        >
          <Show
            when={props.capture}
            fallback={
              <box paddingX={1} paddingY={1}>
                <text fg="#888888">Waiting for output...</text>
              </box>
            }
          >
            {(capture) => (
              <box flexDirection="column" flexGrow={1} width="100%">
                {/* Terminal content — ANSI escape sequences rendered natively */}
                <box flexGrow={1} width="100%">
                  <text fg="#cccccc">{capture().content}</text>
                </box>

                {/* Cursor position indicator */}
                <box height={1} width="100%" paddingX={1}>
                  <text fg="#555555">
                    {`cursor: ${capture().cursor.x},${capture().cursor.y}`}
                  </text>
                </box>
              </box>
            )}
          </Show>
        </Show>
      </box>
    </box>
  );
}
