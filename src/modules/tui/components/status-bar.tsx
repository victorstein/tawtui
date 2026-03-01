import type { Accessor } from 'solid-js';
import { FG_DIM } from '../theme';

export type ReviewsHintContext =
  | { mode: 'repo-left' }
  | { mode: 'agent-left' }
  | { mode: 'prs-right' }
  | { mode: 'terminal-right' }
  | { mode: 'interactive' }
  | { mode: 'empty' };

interface StatusBarProps {
  activeTab: Accessor<number>;
  archiveMode?: Accessor<boolean>;
  reviewsHintCtx?: Accessor<ReviewsHintContext>;
}

const TAB_HINTS = [
  '1-3 switch tab | j/k navigate | n new | enter detail | m/M move | x archive | / filter | q quit',
  '1-3 switch tab | h/l panes | j/k navigate | a add repo | x remove | c config agent | n new agent | i interactive | K kill | r refresh | q quit',
  '1-3 switch tab | h/l day | j/k events | [ / ] week | t today | enter convert | r refresh | q quit',
];

const ARCHIVE_HINT =
  '1-3 switch tab | j/k navigate | u undo | D delete | A back to board | q quit';

function getReviewsHint(ctx: ReviewsHintContext): string {
  const base = '1-3 switch tab';

  switch (ctx.mode) {
    case 'interactive':
      return 'ESC ESC exit interactive | all keys forwarded to agent';
    case 'repo-left':
      return `${base} | h/l panes | j/k navigate | enter PRs | a add repo | x remove | c config agent | n new agent | r refresh | q quit`;
    case 'agent-left':
      return `${base} | h/l panes | j/k navigate | enter interactive | K kill | n new agent | r refresh | q quit`;
    case 'prs-right':
      return `${base} | h/l panes | j/k navigate | enter detail/spawn | r refresh | q quit`;
    case 'terminal-right':
      return `${base} | h/l panes | C-d/C-u scroll | i interactive | K kill | r refresh | q quit`;
    case 'empty':
      return `${base} | a add repo | n new agent | q quit`;
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
