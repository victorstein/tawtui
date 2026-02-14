import { type Accessor, For, Index } from 'solid-js';
import { BG_BASE, ACCENT_PRIMARY, BORDER_DIM } from '../theme';

const LEFT_CAP = '\uE0B6';
const RIGHT_CAP = '\uE0B4';

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

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
      height={2}
      width="100%"
      flexDirection="row"
      justifyContent="center"
      alignItems="center"
      paddingTop={1}
      backgroundColor={BG_BASE}
    >
      <Index each={props.tabs}>
        {(tab, index) => {
          const isActive = () => props.activeTab() === index;
          const pillBg = () => (isActive() ? ACCENT_PRIMARY : BORDER_DIM);
          const label = () => `  ${index + 1} ${tab().name}  `;

          const bgStart = () =>
            isActive() ? ACCENT_PRIMARY : BORDER_DIM;
          const bgEnd = () =>
            isActive() ? '#d43535' : '#0e2a3d';
          const fgColor = () => (isActive() ? '#ffffff' : '#c0bab0');

          return (
            <box flexDirection="row" height={1}>
              {index > 0 && <text> </text>}
              <text fg={bgStart()}>{LEFT_CAP}</text>
              <For each={label().split('')}>
                {(char, i) => {
                  const t = () =>
                    label().length > 1 ? i() / (label().length - 1) : 0;
                  const charBg = () => lerpHex(bgStart(), bgEnd(), t());
                  return (
                    <text
                      fg={fgColor()}
                      bg={charBg()}
                      attributes={isActive() ? 1 : 0}
                    >
                      {char}
                    </text>
                  );
                }}
              </For>
              <text fg={bgEnd()}>{RIGHT_CAP}</text>
            </box>
          );
        }}
      </Index>
    </box>
  );
}
