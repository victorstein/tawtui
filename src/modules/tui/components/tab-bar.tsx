import { type Accessor, Index } from 'solid-js';
import {
  BG_BASE,
  BG_SELECTED,
  ACCENT_PRIMARY,
  BORDER_DIM,
  FG_NORMAL,
  FG_DIM,
} from '../theme';

export interface Tab {
  name: string;
}

interface TabBarProps {
  activeTab: Accessor<number>;
  tabs: Tab[];
}

export function TabBar(props: TabBarProps) {
  return (
    <box
      height={3}
      width="100%"
      flexDirection="row"
      justifyContent="center"
      alignItems="center"
      backgroundColor={BG_BASE}
    >
      <Index each={props.tabs}>
        {(tab, index) => {
          const isActive = () => props.activeTab() === index;
          const label = () => ` ${index + 1} ${tab().name} `;

          return (
            <box
              width={label().length + 2}
              height={3}
              borderStyle="rounded"
              borderColor={isActive() ? ACCENT_PRIMARY : BORDER_DIM}
              backgroundColor={isActive() ? BG_SELECTED : BG_BASE}
            >
              <text
                fg={isActive() ? FG_NORMAL : FG_DIM}
                attributes={isActive() ? 1 : 0}
              >
                {label()}
              </text>
            </box>
          );
        }}
      </Index>
    </box>
  );
}
