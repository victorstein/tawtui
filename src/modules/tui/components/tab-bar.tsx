import { type Accessor, Index } from 'solid-js';
import {
  BG_BASE,
  BG_SELECTED,
  ACCENT_PRIMARY,
  FG_MUTED,
  SEPARATOR_COLOR,
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
      height={1}
      width="100%"
      flexDirection="row"
      justifyContent="center"
      backgroundColor={BG_BASE}
    >
      <Index each={props.tabs}>
        {(tab, index) => {
          const isActive = () => props.activeTab() === index;
          const label = () => `[${index + 1}] ${tab().name}`;

          return (
            <box
              width={label().length + 2}
              height={1}
              backgroundColor={isActive() ? BG_SELECTED : BG_BASE}
            >
              <text
                fg={isActive() ? ACCENT_PRIMARY : FG_MUTED}
                attributes={isActive() ? 1 : 0}
              >
                {` ${label()} `}
              </text>
            </box>
          );
        }}
      </Index>
    </box>
  );
}
