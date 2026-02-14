import { type Accessor, Index } from 'solid-js';
import {
  BG_BASE,
  BG_SELECTED,
  ACCENT_PRIMARY,
  FG_MUTED,
  FG_FAINT,
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
          const inner = () => ` ${index + 1} ${tab().name} `;
          // Rounded pill: ╭ content ╮ for active, ( content ) for inactive
          const label = () =>
            isActive()
              ? `\u256D${inner()}\u256E`
              : `\u2500${inner()}\u2500`;

          return (
            <box
              width={inner().length + 2}
              height={1}
              backgroundColor={isActive() ? BG_SELECTED : BG_BASE}
            >
              <text
                fg={isActive() ? ACCENT_PRIMARY : FG_MUTED}
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
