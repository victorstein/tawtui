import { Show } from 'solid-js';
import type { CaptureResult } from '../../terminal.types';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  SEPARATOR_COLOR,
  FG_NORMAL,
  FG_DIM,
} from '../theme';

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
    if (props.isInteractive) return FG_NORMAL;
    if (props.isActivePane) return FG_NORMAL;
    return FG_DIM;
  };

  const borderColorVal = () => {
    if (props.isInteractive) return ACCENT_PRIMARY;
    if (props.isActivePane) return ACCENT_PRIMARY;
    return BORDER_DIM;
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
      borderColor={borderColorVal()}
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
        <text fg={props.isInteractive ? ACCENT_PRIMARY : SEPARATOR_COLOR} truncate>
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
              <text fg={FG_DIM}>No agent selected</text>
            </box>
          }
        >
          <Show
            when={props.capture}
            fallback={
              <box paddingX={1} paddingY={1}>
                <text fg={FG_DIM}>Waiting for output...</text>
              </box>
            }
          >
            {(capture) => (
              <box flexDirection="column" flexGrow={1} width="100%">
                {/* Terminal content — ANSI escape sequences rendered natively */}
                <box flexGrow={1} width="100%">
                  <text fg={FG_NORMAL}>{capture().content}</text>
                </box>

                {/* Cursor position indicator */}
                <box height={1} width="100%" paddingX={1}>
                  <text fg={FG_DIM}>
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
