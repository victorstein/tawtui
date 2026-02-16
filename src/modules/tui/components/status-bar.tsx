import type { Accessor } from 'solid-js';
import { FG_DIM } from '../theme';

interface StatusBarProps {
  activeTab: Accessor<number>;
  archiveMode?: Accessor<boolean>;
}

const TAB_HINTS = [
  '1-3 switch tab | j/k navigate | n new | enter edit | d done | / filter | A archive | q quit',
  '1-3 switch tab | h/l panes | j/k navigate | a add | x remove | r refresh | enter PR detail | q quit',
  '1-3 switch tab | h/l panes | j/k navigate | n new | i interactive | K kill | r refresh | q quit',
];

const ARCHIVE_HINT =
  '1-3 switch tab | j/k navigate | u undo | D delete | A back to board | q quit';

export function StatusBar(props: StatusBarProps) {
  const hint = () => {
    // Show archive-specific hints when on Tasks tab in archive mode
    if (props.activeTab() === 0 && props.archiveMode?.()) {
      return ARCHIVE_HINT;
    }
    return TAB_HINTS[props.activeTab()] ?? TAB_HINTS[0];
  };

  return (
    <box
      height={1}
      width="100%"
    >
      <text fg={FG_DIM} truncate>{` ${hint()}`}</text>
    </box>
  );
}
