import type { Accessor } from 'solid-js';
import { FG_DIM } from '../theme';

export type ReviewsHintContext =
  | { mode: 'repo-left' }
  | { mode: 'prs-right' }
  | { mode: 'reviews-list' }
  | { mode: 'review-panel' }
  | { mode: 'empty' };

interface StatusBarProps {
  activeTab: Accessor<number>;
  archiveMode?: Accessor<boolean>;
  reviewsHintCtx?: Accessor<ReviewsHintContext>;
}

const TAB_HINTS = [
  '1-3 switch tab | j/k navigate | n new | enter detail | m/M move | x archive | / filter | q quit',
  '1-3 switch tab | h/l panes | j/k navigate | a add repo | x remove | Shift+H review | K remove review | r refresh | q quit',
  '1-3 switch tab | h/l day | j/k events | [ / ] week | t today | enter convert | r refresh | q quit',
];

const ARCHIVE_HINT =
  '1-3 switch tab | j/k navigate | u undo | D delete | A back to board | q quit';

function getReviewsHint(ctx: ReviewsHintContext): string {
  const base = '1-3 switch tab';

  switch (ctx.mode) {
    case 'repo-left':
      return `${base} | h/l panes | j/k navigate | enter PRs | a add repo | x remove | r refresh | q quit`;
    case 'prs-right':
      return `${base} | h/l panes | j/k navigate | enter detail | Shift+H review | r refresh | q quit`;
    case 'reviews-list':
      return `${base} | j/k navigate | enter open panel | o open hunk | K remove | r refresh | q quit`;
    case 'review-panel':
      return `${base} | o open hunk | type + enter chat | esc back | r refresh | q quit`;
    case 'empty':
      return `${base} | a add repo | Shift+H review a PR | q quit`;
  }
}

export function StatusBar(props: StatusBarProps) {
  const hint = () => {
    // Show archive-specific hints when on Tasks tab in archive mode
    if (props.activeTab() === 0 && props.archiveMode?.()) {
      return ARCHIVE_HINT;
    }
    if (props.activeTab() === 1 && props.reviewsHintCtx) {
      return getReviewsHint(props.reviewsHintCtx());
    }
    return TAB_HINTS[props.activeTab()] ?? TAB_HINTS[0];
  };

  return (
    <box height={1} width="100%">
      <text fg={FG_DIM} truncate>{` ${hint()}`}</text>
    </box>
  );
}
