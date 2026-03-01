import { For, Show } from 'solid-js';
import type { RepoConfig } from '../../../shared/types';
import type { TerminalSession } from '../../terminal.types';
import {
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  COLOR_SUCCESS,
  COLOR_ERROR,
  BORDER_DIM,
  REPO_GRAD,
  AGENT_GRAD,
} from '../theme';
import { lerpHex, darkenHex, LEFT_CAP, RIGHT_CAP, getAuthorGradient } from '../utils';

const DIM_FACTOR = 0.5;

/** Abbreviate a worktree path to show just the last 2 segments. */
function abbreviateWorktreePath(fullPath: string): string {
  const parts = fullPath.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : fullPath;
}

/** Status indicator color mapping. */
const STATUS_COLORS: Record<string, string> = {
  running: COLOR_SUCCESS,
  done: FG_DIM,
  failed: COLOR_ERROR,
};

/** Status dot character. */
const STATUS_DOT = '\u25CF';

interface StackedListProps {
  repos: RepoConfig[];
  agents: TerminalSession[];
  /** Flat cursor position: 0..repos.length-1 = repos, repos.length..total-1 = agents */
  cursorIndex: number;
  /** Whether this pane is the active pane */
  isActivePane: boolean;
  width: number;
}

/** Gradient pill header with powerline caps and per-character gradient fill. */
function GradientHeader(props: {
  label: string;
  gradStart: string;
  gradEnd: string;
  innerWidth: number;
  isActivePane: boolean;
}) {
  const colorStart = () =>
    props.isActivePane ? props.gradStart : darkenHex(props.gradStart, DIM_FACTOR);
  const colorEnd = () =>
    props.isActivePane ? props.gradEnd : darkenHex(props.gradEnd, DIM_FACTOR);

  return (
    <>
      {/* Gradient separator above header */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: props.innerWidth }, (_, i) => i)}>
          {(i) => {
            const t = () => (props.innerWidth > 1 ? i / (props.innerWidth - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>{'\u2500'}</text>
            );
          }}
        </For>
      </box>

      {/* Pill header */}
      <box height={1} width="100%" paddingX={1} flexDirection="row">
        <text fg={props.gradStart}>{LEFT_CAP}</text>
        <For each={props.label.split('')}>
          {(char, i) => {
            const t = () =>
              props.label.length > 1 ? i() / (props.label.length - 1) : 0;
            return (
              <text
                fg="#ffffff"
                bg={lerpHex(props.gradStart, props.gradEnd, t())}
                attributes={1}
              >
                {char}
              </text>
            );
          }}
        </For>
        <text fg={props.gradEnd}>{RIGHT_CAP}</text>
      </box>

      {/* Gradient separator below header */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: props.innerWidth }, (_, i) => i)}>
          {(i) => {
            const t = () => (props.innerWidth > 1 ? i / (props.innerWidth - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>{'\u2500'}</text>
            );
          }}
        </For>
      </box>
    </>
  );
}

export default function StackedList(props: StackedListProps) {
  const innerWidth = () => Math.max(props.width - 2, 1);

  /** Whether the cursor is currently in the repos section. */
  const isCursorInRepos = () => props.cursorIndex < props.repos.length;

  /** Border color: lerp midpoint of the active section's gradient, dimmed when inactive pane. */
  const borderColor = () => {
    if (!props.isActivePane) return BORDER_DIM;
    const grad = isCursorInRepos() ? REPO_GRAD : AGENT_GRAD;
    return lerpHex(grad[0], grad[1], 0.5);
  };

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle="single"
      borderColor={borderColor()}
    >
      {/* ── REPOS section ──────────────────────────────────── */}
      <GradientHeader
        label={` REPOS (${props.repos.length}) `}
        gradStart={REPO_GRAD[0]}
        gradEnd={REPO_GRAD[1]}
        innerWidth={innerWidth()}
        isActivePane={props.isActivePane}
      />

      <Show
        when={props.repos.length > 0}
        fallback={
          <box paddingX={1} paddingY={1}>
            <text fg={FG_DIM}>No repos configured</text>
          </box>
        }
      >
        <For each={props.repos}>
          {(repo, index) => {
            const isSelected = () =>
              props.isActivePane && index() === props.cursorIndex;
            return (
              <box
                width="100%"
                paddingX={1}
                paddingBottom={1}
                backgroundColor={isSelected() ? BG_SELECTED : undefined}
                flexDirection="row"
              >
                {/* Owner pill — gradient with powerline caps */}
                {(() => {
                  const ownerGrad = getAuthorGradient(repo.owner);
                  const label = ` ${repo.owner} `;
                  return (
                    <>
                      <text fg={ownerGrad.start}>{LEFT_CAP}</text>
                      <For each={label.split('')}>
                        {(char, i) => {
                          const t =
                            label.length > 1 ? i() / (label.length - 1) : 0;
                          return (
                            <text
                              fg={FG_PRIMARY}
                              bg={lerpHex(ownerGrad.start, ownerGrad.end, t)}
                              attributes={1}
                            >
                              {char}
                            </text>
                          );
                        }}
                      </For>
                      <text fg={ownerGrad.end}>{RIGHT_CAP}</text>
                    </>
                  );
                })()}
                {/* Separator */}
                <text fg={FG_DIM}>{' / '}</text>
                {/* Repo name */}
                <text
                  fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                  attributes={isSelected() ? 1 : 0}
                  truncate
                >
                  {repo.repo}
                </text>
              </box>
            );
          }}
        </For>
      </Show>

      {/* ── AGENTS section ─────────────────────────────────── */}
      <GradientHeader
        label={` AGENTS (${props.agents.length}) `}
        gradStart={AGENT_GRAD[0]}
        gradEnd={AGENT_GRAD[1]}
        innerWidth={innerWidth()}
        isActivePane={props.isActivePane}
      />

      <Show
        when={props.agents.length > 0}
        fallback={
          <box paddingX={1} paddingY={1}>
            <text fg={FG_DIM}>No agents running</text>
          </box>
        }
      >
        <For each={props.agents}>
          {(agent, index) => {
            const isSelected = () =>
              props.isActivePane &&
              props.cursorIndex === props.repos.length + index();
            const statusColor = () => STATUS_COLORS[agent.status] ?? FG_DIM;

            /** Build the metadata line (PR or task association). */
            const metaText = () => {
              const parts: string[] = [];
              if (agent.prNumber != null) {
                parts.push(`PR #${agent.prNumber}`);
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

                {/* Line 3: worktree path if present */}
                <Show when={agent.worktreePath}>
                  <box height={1} width="100%" paddingX={0}>
                    <text fg={FG_DIM} truncate>
                      {`  ${abbreviateWorktreePath(agent.worktreePath!)}`}
                    </text>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
