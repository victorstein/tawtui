import { For, Show, createEffect } from 'solid-js';
import type { ScrollBoxRenderable } from '@opentui/core';
import type { RepoConfig } from '../../../shared/types';
import type { HunkReviewRecord, HunkReviewStatus } from '../../hunk-review.types';
import {
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
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

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

export function reviewStatusGlyph(
  status: HunkReviewStatus,
  spinnerFrame: number,
): string {
  switch (status) {
    case 'creating':
    case 'reviewing':
      return SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
    case 'ready':
    case 'open':
      return '\u2713';
    case 'error':
    case 'interrupted':
    case 'killed':
      return '\u2717';
  }
}

export function formatReviewLabel(r: HunkReviewRecord): string {
  return `PR #${r.prNumber} \u00B7 ${r.repoName}`;
}

interface StackedListProps {
  repos: RepoConfig[];
  reviews: HunkReviewRecord[];
  spinnerFrame: number;
  /** Flat cursor position: 0..repos.length-1 = repos, repos.length..total-1 = reviews */
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

// Row-height constants (terminal rows) used to scroll the selected item into view.
// GradientHeader = 3 rows (grad-sep + pill + grad-sep).
// Repo item = 2 rows (1 content + paddingBottom:1).
// Review item = 2 rows (box height:1 + paddingBottom:1).
// Empty-state fallback = 3 rows (paddingY:1 top + content + paddingY:1 bottom).
const HEADER_ROWS = 3;
const ITEM_ROWS = 2;
const EMPTY_ROWS = 3;

function selectedItemTop(
  cursorIndex: number,
  repoCount: number,
  reviewCount: number,
): number {
  const repoSectionRows =
    repoCount > 0 ? repoCount * ITEM_ROWS : EMPTY_ROWS;

  if (cursorIndex < repoCount) {
    return HEADER_ROWS + cursorIndex * ITEM_ROWS;
  }

  const reviewIdx = cursorIndex - repoCount;
  if (reviewIdx >= 0 && reviewIdx < reviewCount) {
    return HEADER_ROWS + repoSectionRows + HEADER_ROWS + reviewIdx * ITEM_ROWS;
  }

  return 0;
}

export default function StackedList(props: StackedListProps) {
  let scrollRef: ScrollBoxRenderable | undefined;

  const innerWidth = () => Math.max(props.width - 2, 1);

  /** Whether the cursor is currently in the repos section. */
  const isCursorInRepos = () => props.cursorIndex < props.repos.length;

  /** Border color: lerp midpoint of the active section's gradient, dimmed when inactive pane. */
  const borderColor = () => {
    if (!props.isActivePane) return BORDER_DIM;
    const grad = isCursorInRepos() ? REPO_GRAD : AGENT_GRAD;
    return lerpHex(grad[0], grad[1], 0.5);
  };

  createEffect(() => {
    const idx = props.cursorIndex;
    const repoCount = props.repos.length;
    const reviewCount = props.reviews.length;

    if (!scrollRef) return;

    const itemTop = selectedItemTop(idx, repoCount, reviewCount);
    const itemBottom = itemTop + ITEM_ROWS;
    const viewTop = scrollRef.scrollTop;
    const viewHeight = scrollRef.viewport.height;
    const viewBottom = viewTop + viewHeight;

    if (itemBottom > viewBottom) {
      scrollRef.scrollTo(itemBottom - viewHeight);
    } else if (itemTop < viewTop) {
      scrollRef.scrollTo(itemTop);
    }
  });

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle="single"
      borderColor={borderColor()}
    >
      <scrollbox
        ref={(el: ScrollBoxRenderable) => {
          scrollRef = el;
        }}
        flexGrow={1}
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

        {/* ── REVIEWS section ────────────────────────────────── */}
        <GradientHeader
          label={` REVIEWS (${props.reviews.length}) `}
          gradStart={AGENT_GRAD[0]}
          gradEnd={AGENT_GRAD[1]}
          innerWidth={innerWidth()}
          isActivePane={props.isActivePane}
        />

        <Show
          when={props.reviews.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No reviews running</text>
            </box>
          }
        >
          <For each={props.reviews}>
            {(review, index) => {
              const isSelected = () =>
                props.isActivePane &&
                props.cursorIndex === props.repos.length + index();
              const glyph = () =>
                reviewStatusGlyph(review.status, props.spinnerFrame);

              return (
                <box
                  width="100%"
                  flexDirection="column"
                  backgroundColor={isSelected() ? BG_SELECTED : undefined}
                  paddingX={1}
                  paddingBottom={1}
                >
                  <box height={1} width="100%" flexDirection="row">
                    <text fg={FG_DIM}>{glyph()} </text>
                    <text
                      fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                      attributes={isSelected() ? 1 : 0}
                      truncate
                    >
                      {formatReviewLabel(review)}
                    </text>
                  </box>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
