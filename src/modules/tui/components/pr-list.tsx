import { For, Show } from 'solid-js';
import type { PullRequest } from '../../github.types';

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
function getReviewIcon(decision: string | null): { char: string; color: string } {
  switch (decision) {
    case 'APPROVED':
      return { char: '\u2713', color: '#4ecca3' }; // green checkmark
    case 'CHANGES_REQUESTED':
      return { char: '\u2717', color: '#e94560' }; // red X
    case 'REVIEW_REQUIRED':
      return { char: '\u25CF', color: '#f0a500' }; // yellow dot
    default:
      return { char: '\u25CB', color: '#666666' }; // hollow circle, muted
  }
}

/**
 * Returns a CI status indicator character and color based on statusCheckRollup.
 */
function getCiIcon(
  checks: Array<{ name: string; status: string; conclusion: string | null }>,
): { char: string; color: string } {
  if (checks.length === 0) {
    return { char: '\u25CB', color: '#666666' }; // no checks, hollow circle
  }

  const anyFailing = checks.some(
    (c) => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR',
  );
  if (anyFailing) {
    return { char: '\u2717', color: '#e94560' }; // red X
  }

  const allPassed = checks.every(
    (c) => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED',
  );
  if (allPassed) {
    return { char: '\u2713', color: '#4ecca3' }; // green checkmark
  }

  // Some are still pending
  return { char: '\u25CF', color: '#f0a500' }; // yellow dot
}

export function PrList(props: PrListProps) {
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

      {/* Sub-header: repo name */}
      <Show when={subHeaderText()}>
        <box height={1} width="100%" paddingX={1}>
          <text fg="#666666" truncate>
            {subHeaderText()}
          </text>
        </box>
      </Show>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg="#333333" truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Content area */}
      <scrollbox flexGrow={1} width="100%">
        <Show when={!props.repoLabel}>
          <box paddingX={1} paddingY={1}>
            <text fg="#555555">No repo selected</text>
          </box>
        </Show>

        <Show when={props.repoLabel && props.loading}>
          <box paddingX={1} paddingY={1}>
            <text fg="#888888">Loading pull requests...</text>
          </box>
        </Show>

        <Show when={props.repoLabel && props.error}>
          <box paddingX={1} paddingY={1}>
            <text fg="#e94560">Error: {props.error}</text>
          </box>
        </Show>

        <Show when={props.repoLabel && !props.loading && !props.error}>
          <Show
            when={props.prs.length > 0}
            fallback={
              <box paddingX={1} paddingY={1}>
                <text fg="#555555">No open pull requests</text>
              </box>
            }
          >
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
                    backgroundColor={isSelected() ? '#16213e' : undefined}
                    paddingX={1}
                  >
                    {/* Line 1: PR number + title + draft badge */}
                    <box height={1} width="100%" flexDirection="row">
                      <text
                        fg={isSelected() ? '#e94560' : '#888888'}
                        attributes={1}
                      >
                        {`#${pr.number} `}
                      </text>
                      <Show when={pr.isDraft}>
                        <text fg="#666666">[DRAFT] </text>
                      </Show>
                      <text
                        fg={isSelected() ? '#ffffff' : '#cccccc'}
                        attributes={isSelected() ? 1 : 0}
                        truncate
                      >
                        {pr.title}
                      </text>
                    </box>

                    {/* Line 2: author, +/-lines, review icon, CI icon */}
                    <box height={1} width="100%" flexDirection="row">
                      <text fg="#888888">
                        {`  ${pr.author.login}  `}
                      </text>
                      <text fg="#4ecca3">{`+${pr.additions}`}</text>
                      <text fg="#888888">/</text>
                      <text fg="#e94560">{`-${pr.deletions}`}</text>
                      <text fg="#888888">{`  `}</text>
                      <text fg={review().color}>{review().char}</text>
                      <text fg="#888888"> </text>
                      <text fg={ci().color}>{ci().char}</text>
                    </box>
                  </box>
                );
              }}
            </For>
          </Show>
        </Show>
      </scrollbox>
    </box>
  );
}
