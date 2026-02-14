import { For, Show } from 'solid-js';
import type { RepoConfig } from '../../github.types';
import {
  ACCENT_PRIMARY,
  BORDER_DIM,
  SEPARATOR_COLOR,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
} from '../theme';

interface RepoListProps {
  repos: RepoConfig[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
}

export function RepoList(props: RepoListProps) {
  const headerText = () => `REPOS (${props.repos.length})`;

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle={props.isActivePane ? 'double' : 'single'}
      borderColor={props.isActivePane ? ACCENT_PRIMARY : BORDER_DIM}
    >
      {/* Header */}
      <box height={1} width="100%" paddingX={1}>
        <text
          fg={props.isActivePane ? ACCENT_PRIMARY : FG_DIM}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg={SEPARATOR_COLOR} truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Repo list */}
      <scrollbox flexGrow={1} width="100%">
        <Show
          when={props.repos.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg={FG_MUTED}>No repos configured</text>
              <box height={1} />
              <text fg={FG_MUTED}>Press 'a' to add a repo</text>
            </box>
          }
        >
          <For each={props.repos}>
            {(repo, index) => {
              const isSelected = () =>
                props.isActivePane && index() === props.selectedIndex;
              return (
                <box
                  width="100%"
                  height={1}
                  paddingX={1}
                  backgroundColor={isSelected() ? BG_SELECTED : undefined}
                >
                  <text
                    fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                    attributes={isSelected() ? 1 : 0}
                    truncate
                  >
                    {`${repo.owner}/${repo.repo}`}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
