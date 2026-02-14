import {
  For,
  Show,
  Switch,
  Match,
  createSignal,
  onMount,
  onCleanup,
} from 'solid-js';
import type { PullRequest } from '../../github.types';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  SEPARATOR_COLOR,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_SUCCESS,
  COLOR_ERROR,
  COLOR_WARNING,
} from '../theme';

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
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [spinnerIdx, setSpinnerIdx] = createSignal(0);

  let spinnerInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    spinnerInterval = setInterval(() => {
      setSpinnerIdx((i) => (i + 1) % spinnerFrames.length);
    }, 80);
  });
  onCleanup(() => clearInterval(spinnerInterval));

  const headerText = () => {
    if (!props.repoLabel) return 'PULL REQUESTS';
    return `PULL REQUESTS (${props.prs.length})`;
  };

  const subHeaderText = () => {
    if (!props.repoLabel) return null;
    return props.repoLabel;
  };

  return (
    <box
      flexDirection="column"
      flexGrow={1}
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

      {/* Sub-header: repo name */}
      <Show when={subHeaderText()}>
        <box height={1} width="100%" paddingX={1}>
          <text fg={FG_DIM} truncate>
            {subHeaderText()}
          </text>
        </box>
      </Show>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg={SEPARATOR_COLOR} truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Content area */}
      <scrollbox flexGrow={1} width="100%">
        <Switch>
          <Match when={!props.repoLabel}>
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No repo selected</text>
            </box>
          </Match>
          <Match when={props.loading && props.prs.length === 0}>
            <box paddingX={1} paddingY={1} flexDirection="row">
              <text fg={ACCENT_PRIMARY}>{spinnerFrames[spinnerIdx()]}</text>
              <text fg={FG_DIM}> Loading pull requests...</text>
            </box>
          </Match>
          <Match when={props.error}>
            <box paddingX={1} paddingY={1}>
              <text fg={COLOR_ERROR}>Error: {props.error}</text>
            </box>
          </Match>
          <Match when={props.prs.length === 0}>
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No open pull requests</text>
            </box>
          </Match>
          <Match when={props.prs.length > 0}>
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
                  >
                    {/* Line 1: PR number + title + draft badge */}
                    <box height={1} width="100%" flexDirection="row">
                      <text
                        fg={isSelected() ? ACCENT_PRIMARY : FG_DIM}
                        attributes={1}
                      >
                        {`#${pr.number} `}
                      </text>
                      <Show when={pr.isDraft}>
                        <text fg={FG_DIM}>[DRAFT] </text>
                      </Show>
                      <text
                        fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                        attributes={isSelected() ? 1 : 0}
                        truncate
                      >
                        {pr.title}
                      </text>
                    </box>

                    {/* Line 2: author, +/-lines, review icon, CI icon */}
                    <box height={1} width="100%" flexDirection="row">
                      <text fg={FG_DIM}>{`  ${pr.author.login}  `}</text>
                      <text fg={COLOR_SUCCESS}>{`+${pr.additions}`}</text>
                      <text fg={FG_DIM}>/</text>
                      <text fg={COLOR_ERROR}>{`-${pr.deletions}`}</text>
                      <text fg={FG_DIM}>{`  `}</text>
                      <text fg={review().color}>{review().char}</text>
                      <text fg={FG_DIM}> </text>
                      <text fg={ci().color}>{ci().char}</text>
                    </box>
                  </box>
                );
              }}
            </For>
          </Match>
        </Switch>
      </scrollbox>
    </box>
  );
}
