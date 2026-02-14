import { type Accessor, Index } from 'solid-js';

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
      backgroundColor="#1a1a2e"
    >
      <Index each={props.tabs}>
        {(tab, index) => {
          const isActive = () => props.activeTab() === index;
          const label = () => `[${index + 1}] ${tab().name}`;

          return (
            <box
              width={label().length + 2}
              height={1}
              backgroundColor={isActive() ? '#16213e' : '#1a1a2e'}
            >
              <text
                fg={isActive() ? '#e94560' : '#666666'}
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
