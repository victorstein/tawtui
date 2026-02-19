import { For, Show } from 'solid-js';
import type { CaptureResult } from '../../terminal.types';
import {
  AGENT_GRAD,
  INTERACTIVE_GRAD,
  BORDER_DIM,
  SEPARATOR_COLOR,
  FG_NORMAL,
  FG_DIM,
} from '../theme';
import { lerpHex } from '../utils';
import { parseAnsiText } from '../utils/ansi-parser';

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

  const focusedColor = () => lerpHex(AGENT_GRAD[0], AGENT_GRAD[1], 0.5);
  const interactiveColor = () =>
    lerpHex(INTERACTIVE_GRAD[0], INTERACTIVE_GRAD[1], 0.5);

  const borderColorVal = () => {
    if (props.isInteractive) return interactiveColor();
    if (props.isActivePane) return focusedColor();
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
        <text fg={headerColor()} attributes={1} truncate>
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text
          fg={
            props.isInteractive
              ? interactiveColor()
              : props.isActivePane
                ? focusedColor()
                : SEPARATOR_COLOR
          }
          truncate
        >
          {props.isInteractive ? '\u2550'.repeat(200) : '\u2500'.repeat(200)}
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
            {(capture) => {
              const parsedLines = () => parseAnsiText(capture().content);

              return (
                <box flexDirection="column" flexGrow={1} width="100%">
                  {/* Terminal content — ANSI escape sequences rendered as styled text */}
                  <box flexDirection="column" flexGrow={1} width="100%">
                    <For each={parsedLines()}>
                      {(line) => (
                        <box height={1} flexDirection="row">
                          <For each={line}>
                            {(seg) => (
                              <text
                                fg={seg.fg ?? FG_NORMAL}
                                bg={seg.bg}
                                attributes={seg.attrs}
                              >
                                {seg.text}
                              </text>
                            )}
                          </For>
                        </box>
                      )}
                    </For>
                  </box>

                  {/* Cursor position indicator */}
                  <box height={1} width="100%" paddingX={1}>
                    <text fg={FG_DIM}>
                      {`cursor: ${capture().cursor.x},${capture().cursor.y}`}
                    </text>
                  </box>
                </box>
              );
            }}
          </Show>
        </Show>
      </box>
    </box>
  );
}
