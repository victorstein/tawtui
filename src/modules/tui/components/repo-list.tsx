import { For, Show } from 'solid-js';
import type { RepoConfig } from '../../github.types';
import {
  BORDER_DIM,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  REPO_GRAD,
} from '../theme';
import {
  lerpHex,
  darkenHex,
  LEFT_CAP,
  RIGHT_CAP,
  getAuthorGradient,
} from '../utils';

const DIM_FACTOR = 0.5;

interface RepoListProps {
  repos: RepoConfig[];
  selectedIndex: number;
  isActivePane: boolean;
  width: number;
}

export function RepoList(props: RepoListProps) {
  const headerLabel = () => ` REPOS (${props.repos.length}) `;

  const gradStart = () => REPO_GRAD[0];
  const gradEnd = () => REPO_GRAD[1];

  const colorStart = () =>
    props.isActivePane ? gradStart() : darkenHex(gradStart(), DIM_FACTOR);
  const colorEnd = () =>
    props.isActivePane ? gradEnd() : darkenHex(gradEnd(), DIM_FACTOR);

  const innerWidth = () => Math.max(props.width - 2, 1);

  const borderColor = () =>
    props.isActivePane ? lerpHex(gradStart(), gradEnd(), 0.5) : BORDER_DIM;

  return (
    <box
      flexDirection="column"
      width={props.width}
      height="100%"
      borderStyle="single"
      borderColor={borderColor()}
    >
      {/* Gradient top separator */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: innerWidth() }, (_, i) => i)}>
          {(i) => {
            const t = () => (innerWidth() > 1 ? i / (innerWidth() - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>
                {'\u2500'}
              </text>
            );
          }}
        </For>
      </box>

      {/* Pill header */}
      <box height={1} width="100%" paddingX={1} flexDirection="row">
        <text fg={gradStart()}>{LEFT_CAP}</text>
        <For each={headerLabel().split('')}>
          {(char, i) => {
            const t = () =>
              headerLabel().length > 1 ? i() / (headerLabel().length - 1) : 0;
            return (
              <text
                fg="#ffffff"
                bg={lerpHex(gradStart(), gradEnd(), t())}
                attributes={1}
              >
                {char}
              </text>
            );
          }}
        </For>
        <text fg={gradEnd()}>{RIGHT_CAP}</text>
      </box>

      {/* Gradient separator below header */}
      <box height={1} width="100%" flexDirection="row">
        <For each={Array.from({ length: innerWidth() }, (_, i) => i)}>
          {(i) => {
            const t = () => (innerWidth() > 1 ? i / (innerWidth() - 1) : 0);
            return (
              <text fg={lerpHex(colorStart(), colorEnd(), t())}>
                {'\u2500'}
              </text>
            );
          }}
        </For>
      </box>

      {/* Repo list */}
      <scrollbox flexGrow={1} width="100%">
        <Show
          when={props.repos.length > 0}
          fallback={
            <box paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>No repos configured</text>
              <box height={1} />
              <text fg={FG_DIM}>Press 'a' to add a repo</text>
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
                  paddingX={1}
                  paddingBottom={1}
                  backgroundColor={isSelected() ? BG_SELECTED : undefined}
                  flexDirection="row"
                >
                  {/* Owner pill — gradient with powerline caps */}
                  {(() => {
                    const ownerGrad = getAuthorGradient(repo.owner);
                    const label = ` ${repo.owner} `;
                    return (
                      <>
                        <text fg={ownerGrad.start}>{LEFT_CAP}</text>
                        <For each={label.split('')}>
                          {(char, i) => {
                            const t =
                              label.length > 1 ? i() / (label.length - 1) : 0;
                            return (
                              <text
                                fg={FG_PRIMARY}
                                bg={lerpHex(ownerGrad.start, ownerGrad.end, t)}
                                attributes={1}
                              >
                                {char}
                              </text>
                            );
                          }}
                        </For>
                        <text fg={ownerGrad.end}>{RIGHT_CAP}</text>
                      </>
                    );
                  })()}
                  {/* Separator */}
                  <text fg={FG_DIM}>{' / '}</text>
                  {/* Repo name */}
                  <text
                    fg={isSelected() ? FG_PRIMARY : FG_NORMAL}
                    attributes={isSelected() ? 1 : 0}
                    truncate
                  >
                    {repo.repo}
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
