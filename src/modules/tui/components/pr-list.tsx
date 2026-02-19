import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import type { PullRequest } from '../../github.types';
import {
  PR_GRAD,
  ACCENT_PRIMARY,
  ACCENT_TERTIARY,
  BORDER_DIM,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_SUCCESS,
  COLOR_ERROR,
  COLOR_WARNING,
} from '../theme';
import {
  lerpHex,
  darkenHex,
  LEFT_CAP,
  RIGHT_CAP,
  getAuthorGradient,
} from '../utils';

const DIM_FACTOR = 0.5;

interface PrListProps {
  prs: PullRequest[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
  repoLabel: string | null; // "owner/repo" or null when no repo selected
  loading: boolean;
  error: string | null;
}

/**
 * Returns a review decision indicator character and color.
 */
function getReviewIcon(decision: string | null): {
  char: string;
  color: string;
} {
  switch (decision) {
    case 'APPROVED':
      return { char: '\u2713', color: COLOR_SUCCESS };
    case 'CHANGES_REQUESTED':
      return { char: '\u2717', color: COLOR_ERROR };
    case 'REVIEW_REQUIRED':
      return { char: '\u25CF', color: COLOR_WARNING };
    default:
      return { char: '\u25CB', color: FG_MUTED };
  }
}

/**
 * Returns a CI status indicator character and color based on statusCheckRollup.
 */
function getCiIcon(
  checks: Array<{ name: string; status: string; conclusion: string | null }>,
): { char: string; color: string } {
  if (checks.length === 0) {
    return { char: '\u25CB', color: FG_MUTED };
  }

  const anyFailing = checks.some(
    (c) => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR',
  );
  if (anyFailing) {
    return { char: '\u2717', color: COLOR_ERROR };
  }

  const allPassed = checks.every(
    (c) =>
      c.conclusion === 'SUCCESS' ||
      c.conclusion === 'NEUTRAL' ||
      c.conclusion === 'SKIPPED',
  );
  if (allPassed) {
    return { char: '\u2713', color: COLOR_SUCCESS };
  }

  // Some are still pending
  return { char: '\u25CF', color: COLOR_WARNING };
}

export function PrList(props: PrListProps) {
  const spinnerFrames = [
    '\u280B',
    '\u2819',
    '\u2839',
    '\u2838',
    '\u283C',
    '\u2834',
    '\u2826',
    '\u2827',
    '\u2807',
    '\u280F',
  ];
  const [spinnerIdx, setSpinnerIdx] = createSignal(0);

  let spinnerInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    spinnerInterval = setInterval(() => {
      setSpinnerIdx((i) => (i + 1) % spinnerFrames.length);
    }, 80);
  });
  onCleanup(() => clearInterval(spinnerInterval));

  const headerLabel = () => ` PULL REQUESTS (${props.prs.length}) `;

  const subHeaderText = () => {
    if (!props.repoLabel) return null;
    return props.repoLabel;
  };

  const gradStart = () => PR_GRAD[0];
  const gradEnd = () => PR_GRAD[1];
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
      flexGrow={1}
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

      {/* Sub-header: repo label pill */}
      <Show when={subHeaderText()}>
        <box width="100%" paddingX={1} paddingBottom={1} flexDirection="row">
          <text fg={ACCENT_TERTIARY}>{LEFT_CAP}</text>
          <box backgroundColor={ACCENT_TERTIARY}>
            <text fg={FG_NORMAL}>{' ' + subHeaderText() + ' '}</text>
          </box>
          <text fg={ACCENT_TERTIARY}>{RIGHT_CAP}</text>
        </box>
      </Show>

      {/* Status messages (outside scrollbox to avoid stale children) */}
      <Show when={!props.repoLabel}>
        <box paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>No repo selected</text>
        </box>
      </Show>
      <Show when={props.repoLabel && props.loading && props.prs.length === 0}>
        <box paddingX={1} paddingY={1} flexDirection="row">
          <text fg={gradStart()}>{spinnerFrames[spinnerIdx()]}</text>
          <text fg={FG_DIM}> Loading pull requests...</text>
        </box>
      </Show>
      <Show when={props.repoLabel && !!props.error}>
        <box paddingX={1} paddingY={1} flexDirection="column">
          <text fg={COLOR_ERROR}>Error: {props.error}</text>
          <box flexDirection="row">
            <text fg={FG_DIM}>{'Press '}</text>
            <text fg={ACCENT_PRIMARY} attributes={1}>
              {'s'}
            </text>
            <text fg={FG_DIM}>{' to configure dependencies'}</text>
          </box>
        </box>
      </Show>
      <Show
        when={
          props.repoLabel &&
          !props.loading &&
          !props.error &&
          props.prs.length === 0
        }
      >
        <box paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>No open pull requests</text>
        </box>
      </Show>

      {/* PR list (scrollbox only mounted when there are PRs) */}
      <Show when={props.prs.length > 0}>
        <scrollbox flexGrow={1} width="100%">
          <For each={props.prs}>
            {(pr, index) => {
              const isSelected = () =>
                props.isActivePane && index() === props.selectedIndex;
              const review = () => getReviewIcon(pr.reviewDecision);
              const ci = () => getCiIcon(pr.statusCheckRollup);

              return (
                <box
                  width="100%"
                  flexDirection="column"
                  backgroundColor={isSelected() ? BG_SELECTED : undefined}
                  paddingX={1}
                  paddingBottom={1}
                >
                  {/* Line 1: PR number pill + draft badge + title */}
                  <box height={1} width="100%" flexDirection="row">
                    <box
                      backgroundColor={
                        isSelected() ? gradStart() : ACCENT_TERTIARY
                      }
                    >
                      <text fg={FG_PRIMARY} attributes={1}>
                        {` #${pr.number} `}
                      </text>
                    </box>
                    <text> </text>
                    <Show when={pr.isDraft}>
                      <box backgroundColor={darkenHex(COLOR_WARNING, 0.7)}>
                        <text fg={FG_NORMAL}>{' DRAFT '}</text>
                      </box>
                      <text> </text>
                    </Show>
                    <text
                      fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                      attributes={isSelected() ? 1 : 0}
                      truncate
                    >
                      {pr.title}
                    </text>
                  </box>

                  {/* Line 2: Author pill + stats + icons */}
                  <box height={1} width="100%" flexDirection="row">
                    {(() => {
                      const authorGrad = getAuthorGradient(pr.author.login);
                      return (
                        <>
                          <text fg={authorGrad.start}>{LEFT_CAP}</text>
                          <For each={(' @' + pr.author.login + ' ').split('')}>
                            {(char, i) => {
                              const label = ' @' + pr.author.login + ' ';
                              const t =
                                label.length > 1 ? i() / (label.length - 1) : 0;
                              return (
                                <text
                                  fg={FG_NORMAL}
                                  bg={lerpHex(
                                    authorGrad.start,
                                    authorGrad.end,
                                    t,
                                  )}
                                >
                                  {char}
                                </text>
                              );
                            }}
                          </For>
                          <text fg={authorGrad.end}>{RIGHT_CAP}</text>
                        </>
                      );
                    })()}
                    <text fg={FG_DIM}> </text>
                    <text fg={COLOR_SUCCESS}>{`+${pr.additions}`}</text>
                    <text fg={FG_DIM}>/</text>
                    <text fg={COLOR_ERROR}>{`-${pr.deletions}`}</text>
                    <text fg={FG_DIM}>{'  '}</text>
                    <text fg={FG_MUTED}>{'Rev '}</text>
                    <text fg={review().color}>{review().char}</text>
                    <text fg={FG_DIM}>{'  '}</text>
                    <text fg={FG_MUTED}>{'CI '}</text>
                    <text fg={ci().color}>{ci().char}</text>
                  </box>
                </box>
              );
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}
