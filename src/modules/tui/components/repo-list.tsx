import { For, Show } from 'solid-js';
import type { RepoConfig } from '../../github.types';

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
      borderColor={props.isActivePane ? '#e94560' : '#333333'}
    >
      {/* Header */}
      <box height={1} width="100%" paddingX={1}>
        <text
          fg={props.isActivePane ? '#e94560' : '#888888'}
          attributes={1}
          truncate
        >
          {headerText()}
        </text>
      </box>

      {/* Separator */}
      <box height={1} width="100%">
        <text fg="#333333" truncate>
          {'\u2500'.repeat(Math.max(props.width - 2, 1))}
        </text>
      </box>

      {/* Repo list */}
      <scrollbox flexGrow={1} width="100%">
        <Show
          when={props.repos.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg="#555555">No repos configured</text>
              <box height={1} />
              <text fg="#666666">Press 'a' to add a repo</text>
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
                  backgroundColor={isSelected() ? '#16213e' : undefined}
                >
                  <text
                    fg={isSelected() ? '#ffffff' : '#cccccc'}
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
