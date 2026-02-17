import { Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { SyntaxStyle, RGBA, type ScrollBoxRenderable } from '@opentui/core';
import type { PullRequestDetail } from '../../github.types';
import {
  ACCENT_PRIMARY,
  ACCENT_SECONDARY,
  FG_PRIMARY,
  FG_DIM,
  FG_MUTED,
  SEPARATOR_COLOR,
  COLOR_SUCCESS,
  COLOR_ERROR,
  COLOR_WARNING,
  P,
} from '../theme';

const markdownStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex(FG_DIM) },
  'markup.heading': { fg: RGBA.fromHex(ACCENT_PRIMARY), bold: true },
  'markup.strong': { fg: RGBA.fromHex(FG_PRIMARY), bold: true },
  'markup.italic': { fg: RGBA.fromHex(FG_DIM), italic: true },
  'markup.strikethrough': { fg: RGBA.fromHex(FG_MUTED), dim: true },
  'markup.raw': { fg: RGBA.fromHex(P.cream) },
  'markup.link': { fg: RGBA.fromHex(FG_MUTED) },
  'markup.link.label': { fg: RGBA.fromHex(ACCENT_SECONDARY), underline: true },
  'markup.link.url': { fg: RGBA.fromHex(FG_MUTED) },
  conceal: { fg: RGBA.fromHex(SEPARATOR_COLOR) },
});

interface DialogPrDetailProps {
  pr: PullRequestDetail;
  onSendToAgent: () => void;
  onClose: () => void;
}

function getReviewLabel(decision: string | null): {
  text: string;
  color: string;
} {
  switch (decision) {
    case 'APPROVED':
      return { text: '\u2713 Approved', color: COLOR_SUCCESS };
    case 'CHANGES_REQUESTED':
      return { text: '\u2717 Changes requested', color: COLOR_ERROR };
    case 'REVIEW_REQUIRED':
      return { text: '\u25CF Review required', color: COLOR_WARNING };
    default:
      return { text: '\u25CB No reviews', color: FG_MUTED };
  }
}

function getCiLabel(
  checks: Array<{ name: string; status: string; conclusion: string | null }>,
): { text: string; color: string } {
  if (checks.length === 0) {
    return { text: '\u25CB No CI checks', color: FG_MUTED };
  }

  const anyFailing = checks.some(
    (c) => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR',
  );
  if (anyFailing) {
    return { text: '\u2717 CI failing', color: COLOR_ERROR };
  }

  const allPassed = checks.every(
    (c) =>
      c.conclusion === 'SUCCESS' ||
      c.conclusion === 'NEUTRAL' ||
      c.conclusion === 'SKIPPED',
  );
  if (allPassed) {
    return { text: '\u2713 CI passed', color: COLOR_SUCCESS };
  }

  return { text: '\u25CF CI pending', color: COLOR_WARNING };
}

/**
 * Strip GitHub-internal noise from PR descriptions:
 * - diffhunk:// reference links: [1] (diffhunk://...)
 * - Standalone diffhunk URLs in parentheses
 */
function cleanPrBody(body: string): string {
  return body
    .replace(/\s*\[\d+\]\s*\(diffhunk:\/\/[^)]*\)/g, '')
    .replace(/\s*\(diffhunk:\/\/[^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function DialogPrDetail(props: DialogPrDetailProps) {
  let scrollRef: ScrollBoxRenderable | undefined;

  useKeyboard((key) => {
    if (key.name === 's') {
      props.onSendToAgent();
      return;
    }
    if (key.name === 'escape') {
      props.onClose();
      return;
    }
    // Half-page scroll: Ctrl+D / Ctrl+U
    if (key.ctrl && key.name === 'd') {
      scrollRef?.scrollBy(0.5, 'viewport');
      return;
    }
    if (key.ctrl && key.name === 'u') {
      scrollRef?.scrollBy(-0.5, 'viewport');
      return;
    }
    // Line scroll: j/k or Up/Down arrows
    if (key.name === 'j' || key.name === 'down') {
      scrollRef?.scrollBy(1, 'step');
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      scrollRef?.scrollBy(-1, 'step');
      return;
    }
    // Full-page scroll: Page Down / Page Up
    if (key.name === 'pagedown') {
      scrollRef?.scrollBy(1, 'viewport');
      return;
    }
    if (key.name === 'pageup') {
      scrollRef?.scrollBy(-1, 'viewport');
      return;
    }
    // Jump to top/bottom: g / G
    if (key.name === 'g' && !key.shift) {
      scrollRef?.scrollTo(0);
      return;
    }
    if (key.name === 'g' && key.shift) {
      scrollRef?.scrollTo(scrollRef.scrollHeight);
      return;
    }
  });

  const review = () => getReviewLabel(props.pr.reviewDecision);
  const ci = () => getCiLabel(props.pr.statusCheckRollup);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* FIXED: Header section with metadata */}
      <box flexDirection="column" paddingX={1} paddingTop={1}>
        {/* PR number + title */}
        <box flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {`#${props.pr.number} `}
          </text>
          <text fg={FG_PRIMARY} attributes={1} truncate>
            {props.pr.title}
          </text>
        </box>

        {/* Spacer */}
        <box height={1} />

        {/* Branch info */}
        <box height={1}>
          <text fg={FG_DIM}>
            {`${props.pr.headRefName} \u2192 ${props.pr.baseRefName}`}
          </text>
        </box>

        {/* Author */}
        <box height={1}>
          <text fg={FG_DIM}>{`Author: ${props.pr.author.login}`}</text>
        </box>

        {/* Stats: additions, deletions, changed files */}
        <box height={1} flexDirection="row">
          <text fg={COLOR_SUCCESS}>{`+${props.pr.additions}`}</text>
          <text fg={FG_DIM}> </text>
          <text fg={COLOR_ERROR}>{`-${props.pr.deletions}`}</text>
          <text fg={FG_DIM}>
            {` (${props.pr.changedFiles} file${props.pr.changedFiles === 1 ? '' : 's'})`}
          </text>
        </box>

        {/* Review status + CI status */}
        <box height={1} flexDirection="row">
          <text fg={review().color}>{review().text}</text>
          <text fg={FG_DIM}>{'  '}</text>
          <text fg={ci().color}>{ci().text}</text>
        </box>

        {/* Separator before description */}
        <box height={1} />
        <box height={1}>
          <text fg={SEPARATOR_COLOR}>{'\u2500'.repeat(60)}</text>
        </box>
        <box height={1} />
      </box>

      {/* SCROLLABLE: PR body only */}
      <scrollbox
        ref={(el: ScrollBoxRenderable) => {
          scrollRef = el;
        }}
        flexGrow={1}
        paddingX={1}
        paddingY={1}
      >
        <Show
          when={props.pr.body}
          fallback={<text fg={FG_MUTED}>No description provided.</text>}
        >
          <markdown
            content={cleanPrBody(props.pr.body)}
            syntaxStyle={markdownStyle}
            conceal={true}
          />
        </Show>
      </scrollbox>

      {/* FIXED: Bottom action bar */}
      <box flexDirection="column" paddingX={1} paddingBottom={1}>
        <box height={1}>
          <text fg={SEPARATOR_COLOR}>{'\u2500'.repeat(60)}</text>
        </box>
        <box height={1} flexDirection="row">
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[S]'}
          </text>
          <text fg={FG_DIM}>{' Send to Agent  '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {'[Esc]'}
          </text>
          <text fg={FG_DIM}>{' Close  '}</text>
          <text fg={FG_MUTED}>{'j/k scroll  g/G top/bottom  ^D/^U page'}</text>
        </box>
      </box>
    </box>
  );
}
