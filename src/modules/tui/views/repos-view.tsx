import { createSignal, createEffect, on, onMount } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { RepoConfig } from '../../../shared/types';
import type { PullRequest, PullRequestDetail } from '../../github.types';
import { RepoList } from '../components/repo-list';
import { PrList } from '../components/pr-list';
import { DialogPrDetail } from '../components/dialog-pr-detail';
import { useDialog } from '../context/dialog';
import { DialogPrompt } from '../components/dialog-prompt';
import { DialogConfirm } from '../components/dialog-confirm';
import { DialogSetupWizard } from '../components/dialog-setup-wizard';
import {
  getGithubService,
  getConfigService,
  getDependencyService,
  getCreatePrReviewSession,
} from '../bridge';
import { ACCENT_PRIMARY, FG_DIM, COLOR_ERROR } from '../theme';
import type { DependencyStatus } from '../../dependency.types';

/** Pane identifiers for the split-pane layout. */
type Pane = 'repos' | 'prs';

interface ReposViewProps {
  refreshTrigger?: () => number;
}

export function ReposView(props: ReposViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  // Active pane state
  const [activePane, setActivePane] = createSignal<Pane>('repos');

  // Repo list state
  const [repos, setRepos] = createSignal<RepoConfig[]>([]);
  const [repoIndex, setRepoIndex] = createSignal(0);

  // PR list state
  const [prs, setPrs] = createSignal<PullRequest[]>([]);
  const [prIndex, setPrIndex] = createSignal(0);
  const [prLoading, setPrLoading] = createSignal(false);
  const [prError, setPrError] = createSignal<string | null>(null);

  // Version counter to prevent stale async PR responses
  let prLoadVersion = 0;

  /** Load repos from ConfigService. */
  function loadRepos(): void {
    const config = getConfigService();
    if (!config) return;
    const loaded = config.getRepos();
    setRepos(loaded);
    // Clamp selection
    if (repoIndex() >= loaded.length) {
      setRepoIndex(Math.max(loaded.length - 1, 0));
    }
  }

  /** Load PRs for the currently selected repo. */
  async function loadPRs(): Promise<void> {
    const repoList = repos();
    const idx = repoIndex();
    if (repoList.length === 0 || idx >= repoList.length) {
      setPrs([]);
      setPrError(null);
      return;
    }

    const gh = getGithubService();
    if (!gh) {
      setPrError('GithubService not available');
      return;
    }

    const repo = repoList[idx];
    const version = ++prLoadVersion;
    setPrLoading(true);
    setPrError(null);
    setPrs([]);
    setPrIndex(0);

    try {
      const prList = await gh.listPRs(repo.owner, repo.repo);
      // Discard stale response if user switched repos while loading
      if (version !== prLoadVersion) return;
      setPrs(prList);
      if (prIndex() >= prList.length) {
        setPrIndex(Math.max(prList.length - 1, 0));
      }
    } catch (err) {
      if (version !== prLoadVersion) return;
      setPrError(err instanceof Error ? err.message : 'Failed to load PRs');
      setPrs([]);
    } finally {
      if (version === prLoadVersion) {
        setPrLoading(false);
      }
    }
  }

  /** Get the currently selected repo (if any). */
  function selectedRepo(): RepoConfig | null {
    const repoList = repos();
    const idx = repoIndex();
    return repoList[idx] ?? null;
  }

  /** Get the label for the currently selected repo. */
  function selectedRepoLabel(): string | null {
    const repo = selectedRepo();
    if (!repo) return null;
    return `${repo.owner}/${repo.repo}`;
  }

  // Reload PRs when the selected repo changes
  createEffect(() => {
    // Track reactive dependencies
    const repoList = repos();
    const idx = repoIndex();
    // Only load if we actually have repos
    if (repoList.length > 0 && idx < repoList.length) {
      loadPRs();
    } else {
      setPrs([]);
      setPrError(null);
    }
  });

  // Add repo dialog
  function showAddRepoDialog(): void {
    const gh = getGithubService();
    const config = getConfigService();
    if (!gh || !config) return;

    dialog.show(
      () => (
        <DialogPrompt
          title="Add Repository"
          placeholder="owner/repo or GitHub URL"
          onSubmit={async (value: string) => {
            dialog.close();
            const parsed = gh.parseRepoUrl(value);
            if (!parsed) {
              // Show error - reopen with message. For simplicity, just close.
              return;
            }

            // Validate the repo exists on GitHub
            const valid = await gh.validateRepo(parsed.owner, parsed.repo);
            if (!valid) {
              return;
            }

            config.addRepo(parsed);
            loadRepos();
            // Select the newly added repo (it will be at the end)
            const newRepos = config.getRepos();
            const newIdx = newRepos.findIndex(
              (r) => r.owner === parsed.owner && r.repo === parsed.repo,
            );
            if (newIdx >= 0) {
              setRepoIndex(newIdx);
            }
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'medium' },
    );
  }

  // Remove repo dialog
  function showRemoveRepoDialog(): void {
    const repo = selectedRepo();
    if (!repo) return;
    const config = getConfigService();
    if (!config) return;

    dialog.show(
      () => (
        <DialogConfirm
          message={`Remove ${repo.owner}/${repo.repo} from your repos?`}
          onConfirm={() => {
            dialog.close();
            config.removeRepo(repo.owner, repo.repo);
            loadRepos();
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'small' },
    );
  }

  // Keyboard navigation
  useKeyboard((key) => {
    // Don't handle keys when a dialog is open
    if (dialog.isOpen()) return;

    // Setup wizard (when error is showing)
    if (key.name === 's' && prError()) {
      const depService = getDependencyService();
      if (!depService) return;
      void depService.checkAll().then((depStatus: DependencyStatus) => {
        dialog.show(
          () => (
            <DialogSetupWizard
              status={depStatus}
              onCheckAgain={() => depService.checkAll()}
              onContinue={() => {
                dialog.close();
                loadPRs();
              }}
            />
          ),
          { size: 'large' },
        );
      });
      return;
    }

    const pane = activePane();

    // Pane switching: h/l or Left/Right
    if (key.name === 'h' || key.name === 'left') {
      setActivePane('repos');
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      if (repos().length > 0) {
        setActivePane('prs');
      }
      return;
    }

    // Within-pane navigation: j/k or Down/Up
    if (key.name === 'j' || key.name === 'down') {
      if (pane === 'repos') {
        setRepoIndex((i) => Math.min(i + 1, Math.max(repos().length - 1, 0)));
      } else {
        setPrIndex((i) => Math.min(i + 1, Math.max(prs().length - 1, 0)));
      }
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      if (pane === 'repos') {
        setRepoIndex((i) => Math.max(i - 1, 0));
      } else {
        setPrIndex((i) => Math.max(i - 1, 0));
      }
      return;
    }

    // Add repo
    if (key.name === 'a') {
      showAddRepoDialog();
      return;
    }

    // Remove selected repo
    if (key.name === 'x') {
      if (pane === 'repos' && selectedRepo()) {
        showRemoveRepoDialog();
      }
      return;
    }

    // Refresh PRs
    if (key.name === 'r') {
      loadPRs();
      return;
    }

    // Enter: on repos pane → switch to PRs, on PRs pane → open detail
    if (key.name === 'return') {
      if (pane === 'repos' && repos().length > 0) {
        setActivePane('prs');
        return;
      }
      if (pane === 'prs') {
        const repoList = repos();
        const repo = repoList[repoIndex()];
        const prList = prs();
        const pr = prList[prIndex()];
        if (!pr || !repo) return;

        const gh = getGithubService();
        if (!gh) return;

        // Show loading dialog
        dialog.show(
          () => (
            <box flexDirection="column" paddingX={1} paddingY={1}>
              <text fg={FG_DIM}>Loading PR details...</text>
            </box>
          ),
          { size: 'large' },
        );

        // Fetch full PR details async
        gh.getPR(repo.owner, repo.repo, pr.number)
          .then((detail: PullRequestDetail) => {
            dialog.close();
            dialog.show(
              () => (
                <DialogPrDetail
                  pr={detail}
                  onSendToAgent={() => {
                    dialog.close();
                    const createSession = getCreatePrReviewSession();
                    if (!createSession) return;
                    createSession(
                      detail.number,
                      repo.owner,
                      repo.repo,
                      detail.title,
                    )
                      .catch(() => {
                        dialog.show(
                          () => (
                            <box
                              flexDirection="column"
                              paddingX={1}
                              paddingY={1}
                            >
                              <text fg={COLOR_ERROR}>
                                Failed to create review agent
                              </text>
                              <box height={1} />
                              <box flexDirection="row">
                                <text fg={ACCENT_PRIMARY} attributes={1}>
                                  {' [Esc] '}
                                </text>
                                <text fg={FG_DIM}>Close</text>
                              </box>
                            </box>
                          ),
                          { size: 'medium' },
                        );
                      });
                  }}
                  onClose={() => dialog.close()}
                />
              ),
              { size: 'large' },
            );
          })
          .catch(() => {
            dialog.close();
            dialog.show(
              () => (
                <box flexDirection="column" paddingX={1} paddingY={1}>
                  <text fg={COLOR_ERROR}>Failed to load PR details</text>
                  <box height={1} />
                  <box flexDirection="row">
                    <text fg={ACCENT_PRIMARY} attributes={1}>
                      {' [Esc] '}
                    </text>
                    <text fg={FG_DIM}>Close</text>
                  </box>
                </box>
              ),
              { size: 'medium' },
            );
          });
      }
      return;
    }
  });

  // Initial data load
  onMount(() => {
    loadRepos();
  });

  // Reload when parent bumps refreshTrigger (e.g. after setup wizard)
  createEffect(
    on(() => props.refreshTrigger?.(), () => {
      loadRepos();
      loadPRs();
    }, { defer: true }),
  );

  // Calculate pane widths from terminal dimensions.
  const repoPaneWidth = () => {
    const termWidth = dimensions().width;
    return Math.floor(termWidth * 0.3);
  };

  const prPaneWidth = () => {
    const termWidth = dimensions().width;
    return termWidth - repoPaneWidth();
  };

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      {/* Split-pane layout */}
      <box flexDirection="row" flexGrow={1} width="100%">
        <RepoList
          repos={repos()}
          selectedIndex={repoIndex()}
          isActivePane={activePane() === 'repos'}
          width={repoPaneWidth()}
        />
        <PrList
          prs={prs()}
          selectedIndex={prIndex()}
          isActivePane={activePane() === 'prs'}
          width={prPaneWidth()}
          repoLabel={selectedRepoLabel()}
          loading={prLoading()}
          error={prError()}
        />
      </box>
    </box>
  );
}
