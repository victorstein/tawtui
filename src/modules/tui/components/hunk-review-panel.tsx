import { For, Show } from 'solid-js';
import type { ReviewFinding } from '../../hunk-review.types';
import {
  ACCENT_PRIMARY,
  FG_DIM,
  FG_NORMAL,
  FG_PRIMARY,
  COLOR_ERROR,
  BORDER_DIM,
  BORDER_ACTIVE,
  SEPARATOR_COLOR,
} from '../theme';

export function formatUnanchoredHeader(count: number): string {
  return `Un-anchored findings (${count})`;
}

interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
}

interface HunkReviewPanelProps {
  summary: string;
  unanchored: ReviewFinding[];
  unanchoredCount: number;
  chat: ChatMessage[];
  status: string;
  error?: string;
  chatInput: string;
  isActivePane: boolean;
  onChatInput: (v: string) => void;
  onSend: () => void;
  onOpenHunk: () => void;
}

export function HunkReviewPanel(props: HunkReviewPanelProps) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      height="100%"
      borderStyle="single"
      borderColor={props.isActivePane ? BORDER_ACTIVE : BORDER_DIM}
    >
      {/* Title */}
      <box height={1} width="100%" paddingX={1}>
        <text fg={ACCENT_PRIMARY} attributes={1} truncate>
          HUNK REVIEW
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg={SEPARATOR_COLOR} truncate>
          {'─'.repeat(200)}
        </text>
      </box>

      <scrollbox flexGrow={1} width="100%" focusable={false}>
        <box flexDirection="column" flexGrow={1} width="100%" paddingX={1}>
          {/* Summary */}
          <box paddingY={1}>
            <text fg={FG_NORMAL}>{props.summary}</text>
          </box>

          {/* Un-anchored findings */}
          <box height={1}>
            <text fg={ACCENT_PRIMARY} attributes={1}>
              {formatUnanchoredHeader(props.unanchoredCount)}
            </text>
          </box>

          <Show
            when={props.unanchored.length > 0}
            fallback={
              <box paddingY={1}>
                <text fg={FG_DIM}>No un-anchored findings.</text>
              </box>
            }
          >
            <For each={props.unanchored}>
              {(finding) => (
                <box height={1} paddingLeft={1}>
                  <text fg={FG_DIM}>
                    {finding.file}
                    {finding.line !== null ? `:${finding.line}` : ''} —{' '}
                    {finding.summary}
                  </text>
                </box>
              )}
            </For>
          </Show>

          {/* Separator */}
          <box height={1} paddingY={1}>
            <text fg={SEPARATOR_COLOR} truncate>
              {'─'.repeat(200)}
            </text>
          </box>

          {/* Chat transcript */}
          <box height={1}>
            <text fg={ACCENT_PRIMARY} attributes={1}>
              Chat
            </text>
          </box>

          <Show
            when={props.chat.length > 0}
            fallback={
              <box paddingY={1}>
                <text fg={FG_DIM}>No messages yet.</text>
              </box>
            }
          >
            <For each={props.chat}>
              {(msg) => (
                <box flexDirection="column" paddingY={1}>
                  <box height={1}>
                    <text
                      fg={msg.role === 'user' ? FG_PRIMARY : ACCENT_PRIMARY}
                      attributes={1}
                    >
                      {msg.role === 'user' ? 'You' : 'Agent'}
                    </text>
                  </box>
                  <box>
                    <text fg={msg.role === 'user' ? FG_NORMAL : FG_DIM}>
                      {msg.text}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </Show>

          {/* Separator */}
          <box height={1}>
            <text fg={SEPARATOR_COLOR} truncate>
              {'─'.repeat(200)}
            </text>
          </box>

          {/* Status */}
          <box height={1} flexDirection="row">
            <text fg={FG_DIM}>{'Status: '}</text>
            <text fg={FG_NORMAL}>{props.status}</text>
          </box>

          {/* Error */}
          <Show when={props.error}>
            {(err) => (
              <box paddingY={1}>
                <text fg={COLOR_ERROR}>{err()}</text>
              </box>
            )}
          </Show>

          {/* Chat input */}
          <box
            height={1}
            flexDirection="row"
            borderStyle="single"
            borderColor={BORDER_ACTIVE}
            paddingX={1}
          >
            <text fg={FG_DIM}>{'> '}</text>
            <text fg={FG_NORMAL}>{props.chatInput}</text>
            <text fg={FG_DIM}>{' [Enter] send'}</text>
          </box>

          {/* Open in hunk affordance */}
          <box height={1} paddingY={1}>
            <text fg={FG_DIM}>[O] Open in hunk</text>
          </box>
        </box>
      </scrollbox>
    </box>
  );
}
