import {
  createSignal,
  createEffect,
  on,
  onMount,
  onCleanup,
  Show,
  Switch,
  Match,
} from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { RepoConfig } from '../../../shared/types';
import type {
  PullRequest,
  PullRequestDetail,
  PrDiff,
} from '../../github.types';
import type { TerminalSession, CaptureResult } from '../../terminal.types';
import type { ProjectAgentConfig } from '../../config.types';
import type { GithubService } from '../../github.service';
import type { ConfigService } from '../../config.service';
import type { TerminalService } from '../../terminal.service';
import type { DependencyService } from '../../dependency.service';
import type { DependencyStatus } from '../../dependency.types';
import type { ReviewsHintContext } from '../components/status-bar';
import StackedList from '../components/stacked-list';
import { PrList } from '../components/pr-list';
import { TerminalOutput } from '../components/terminal-output';
import { DialogPrDetail } from '../components/dialog-pr-detail';
import { DialogProjectAgentConfig } from '../components/dialog-project-agent-config';
import { DialogConfirm } from '../components/dialog-confirm';
import { DialogSelect } from '../components/dialog-select';
import { DialogPrompt } from '../components/dialog-prompt';
import { DialogSetupWizard } from '../components/dialog-setup-wizard';
import { AgentForm } from '../components/agent-form';
import { useDialog } from '../context/dialog';
import { ACCENT_PRIMARY, FG_DIM, COLOR_ERROR } from '../theme';

// ------------------------------------------------------------------
// Service accessors
// ------------------------------------------------------------------

function getGithubService(): GithubService | null {
  return (globalThis as any).__tawtui?.githubService ?? null;
}

function getConfigService(): ConfigService | null {
  return (globalThis as any).__tawtui?.configService ?? null;
}

function getTerminalService(): TerminalService | null {
  return (globalThis as any).__tawtui?.terminalService ?? null;
}

function getDependencyService(): DependencyService | null {
  return (globalThis as any).__tawtui?.dependencyService ?? null;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Pane = 'left' | 'right';

type LeftSelection =
  | { kind: 'repo'; repo: RepoConfig; repoIndex: number }
  | { kind: 'agent'; agent: TerminalSession; agentIndex: number }
  | { kind: 'empty' };

interface ReviewsViewProps {
  refreshTrigger?: () => number;
  onInputCapturedChange?: (captured: boolean) => void;
  onHintContextChange?: (ctx: ReviewsHintContext) => void;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function ReviewsView(props: ReviewsViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  // ── State signals ───────────────────────────────────────────────
  const [activePane, setActivePane] = createSignal<Pane>('left');
  const [cursorIndex, setCursorIndex] = createSignal(0);

  // Repo state
  const [repos, setRepos] = createSignal<RepoConfig[]>([]);

  // PR state
  const [prs, setPrs] = createSignal<PullRequest[]>([]);
  const [prIndex, setPrIndex] = createSignal(0);
  const [prLoading, setPrLoading] = createSignal(false);
  const [prError, setPrError] = createSignal<string | null>(null);
  let prLoadVersion = 0;

  // Agent state
  const [agents, setAgents] = createSignal<TerminalSession[]>([]);

  // Terminal capture state
  const [capture, setCapture] = createSignal<CaptureResult | null>(null);

  // Interactive mode state
  const [interactive, setInteractive] = createSignal(false);

  // Error display state
  const [error, setError] = createSignal<string | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function showError(message: string): void {
    setError(message);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => setError(null), 5000);
  }

  // Propagate interactive state to parent
  createEffect(() => {
    props.onInputCapturedChange?.(interactive());
  });

  // ── Derived helpers ─────────────────────────────────────────────

  const totalItems = () => repos().length + agents().length;

  const selectedItem = (): LeftSelection => {
    const idx = cursorIndex();
    const repoList = repos();
    const agentList = agents();
    if (repoList.length > 0 && idx < repoList.length) {
      return { kind: 'repo', repo: repoList[idx], repoIndex: idx };
    }
    const agentIdx = idx - repoList.length;
    if (agentList.length > 0 && agentIdx >= 0 && agentIdx < agentList.length) {
      return {
        kind: 'agent',
        agent: agentList[agentIdx],
        agentIndex: agentIdx,
      };
    }
    return { kind: 'empty' };
  };

  const rightPaneMode = (): 'prs' | 'terminal' => {
    const sel = selectedItem();
    return sel.kind === 'agent' ? 'terminal' : 'prs';
  };

  const selectedRepoLabel = (): string | null => {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return null;
    return `${sel.repo.owner}/${sel.repo.repo}`;
  };

  // Propagate hint context to parent (StatusBar)
  createEffect(() => {
    const sel = selectedItem();
    const pane = activePane();
    const isInteractive = interactive();

    let ctx: ReviewsHintContext;
    if (isInteractive) {
      ctx = { mode: 'interactive' };
    } else if (pane === 'right') {
      ctx =
        rightPaneMode() === 'terminal'
          ? { mode: 'terminal-right' }
          : { mode: 'prs-right' };
    } else if (sel.kind === 'repo') {
      ctx = { mode: 'repo-left' };
    } else if (sel.kind === 'agent') {
      ctx = { mode: 'agent-left' };
    } else {
      ctx = { mode: 'empty' };
    }
    props.onHintContextChange?.(ctx);
  });

  // ── Data loading ────────────────────────────────────────────────

  function loadRepos(): void {
    const config = getConfigService();
    if (!config) return;
    const loaded = config.getRepos();
    setRepos(loaded);
    if (cursorIndex() >= loaded.length + agents().length) {
      setCursorIndex(Math.max(loaded.length + agents().length - 1, 0));
    }
  }

  function loadAgents(): void {
    const ts = getTerminalService();
    if (!ts) return;
    const sessions = ts.listSessions();
    setAgents(sessions);
    if (cursorIndex() >= repos().length + sessions.length) {
      setCursorIndex(Math.max(repos().length + sessions.length - 1, 0));
    }
  }

  async function loadPRs(): Promise<void> {
    const sel = selectedItem();
    if (sel.kind !== 'repo') {
      setPrs([]);
      setPrError(null);
      return;
    }

    const gh = getGithubService();
    if (!gh) {
      setPrError('GithubService not available');
      return;
    }

    const repo = sel.repo;
    const version = ++prLoadVersion;
    setPrLoading(true);
    setPrError(null);
    setPrs([]);
    setPrIndex(0);

    try {
      const prList = await gh.listPRs(repo.owner, repo.repo);
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

  async function refreshCapture(): Promise<void> {
    const ts = getTerminalService();
    const sel = selectedItem();
    if (!ts || sel.kind !== 'agent') {
      setCapture(null);
      return;
    }
    try {
      const result = await ts.captureOutput(sel.agent.id);
      if (result.changed || capture() === null) {
        setCapture(result);
      }
    } catch {
      loadAgents();
      setCapture(null);
    }
  }

  async function resizeTmuxPane(): Promise<void> {
    const ts = getTerminalService();
    const sel = selectedItem();
    if (!ts || sel.kind !== 'agent') return;

    const termWidth = dimensions().width;
    const termHeight = dimensions().height;
    const outputWidth = termWidth - Math.floor(termWidth * 0.3);
    const cols = Math.max(outputWidth - 4, 10);
    const rows = Math.max(termHeight - 8, 5);

    try {
      await ts.resize(sel.agent.id, cols, rows);
    } catch {
      // Ignore resize errors
    }
  }

  // ── Poll overlap guard ──────────────────────────────────────────

  let isPolling = false;

  async function doPoll(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
      await refreshCapture();
    } finally {
      isPolling = false;
    }
  }

  // ── Adaptive polling ────────────────────────────────────────────

  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function getPollInterval(): number {
    if (agents().length === 0 && selectedItem().kind !== 'agent') return 2000;
    if (interactive()) return 80;
    if (activePane() === 'right' && rightPaneMode() === 'terminal') return 200;
    if (selectedItem().kind === 'agent') return 500;
    return 2000;
  }

  function schedulePoll(): void {
    pollTimer = setTimeout(() => {
      void doPoll().then(() => schedulePoll());
    }, getPollInterval());
  }

  // ── Effects and lifecycle ───────────────────────────────────────

  // Consolidated resize effect with debounce for agent selection
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // Effect: handle agent selection — resize tmux and refresh capture
  createEffect(() => {
    dimensions(); // re-run on terminal resize
    const sel = selectedItem();
    if (sel.kind === 'agent') {
      setCapture(null);
      void refreshCapture();
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(() => {
        void resizeTmuxPane();
      }, 50);
    }
  });

  // Separate effect: handle repo selection — load PRs
  // Tracks only repos and cursorIndex, NOT agents, to avoid spurious reloads
  createEffect(() => {
    const repoList = repos();
    const idx = cursorIndex();
    void repoList;
    void idx;

    const sel = selectedItem();
    if (sel.kind === 'repo') {
      loadPRs();
    } else if (sel.kind === 'empty') {
      setPrs([]);
      setPrError(null);
      setCapture(null);
    }
  });

  // Restart polling when relevant state changes
  createEffect(() => {
    interactive();
    activePane();
    void agents().length;
    void selectedItem().kind;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
    }
    schedulePoll();
  });

  onMount(() => {
    loadRepos();
    loadAgents();
    // Note: schedulePoll() is NOT called here because the createEffect
    // tracking polling-relevant signals fires eagerly on mount.
  });

  onCleanup(() => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    if (escTimer) {
      clearTimeout(escTimer);
      escTimer = null;
    }
  });

  // Reload when parent bumps refreshTrigger
  createEffect(
    on(
      () => props.refreshTrigger?.(),
      () => {
        loadRepos();
        loadAgents();
      },
      { defer: true },
    ),
  );

  // ── Dialogs ─────────────────────────────────────────────────────

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
            if (!parsed) return;

            const valid = await gh.validateRepo(parsed.owner, parsed.repo);
            if (!valid) return;

            config.addRepo(parsed);
            loadRepos();
            const newRepos = config.getRepos();
            const newIdx = newRepos.findIndex(
              (r) => r.owner === parsed.owner && r.repo === parsed.repo,
            );
            if (newIdx >= 0) {
              setCursorIndex(newIdx);
            }
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'medium' },
    );
  }

  function showRemoveRepoDialog(): void {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return;
    const config = getConfigService();
    if (!config) return;

    const repo = sel.repo;
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

  function showNewAgentDialog(): void {
    const ts = getTerminalService();
    if (!ts) return;

    dialog.show(
      () => (
        <AgentForm
          onSubmit={async (data) => {
            dialog.close();
            try {
              const session = await ts.createSession({
                name: data.name,
                cwd: process.cwd(),
                command: data.command || undefined,
              });

              if (data.taskUuid) {
                const tw = (globalThis as any).__tawtui?.taskwarriorService;
                if (tw) {
                  try {
                    await tw.startTask(data.taskUuid);
                  } catch {
                    // Non-fatal
                  }
                }
              }

              loadAgents();
              const updated = ts.listSessions();
              const newIdx = updated.findIndex((s) => s.id === session.id);
              if (newIdx >= 0) {
                setCursorIndex(repos().length + newIdx);
              }
            } catch {
              showError('Session creation failed');
            }
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'large' },
    );
  }

  function showKillAgentDialog(): void {
    const sel = selectedItem();
    if (sel.kind !== 'agent') return;
    const ts = getTerminalService();
    if (!ts) return;

    const agent = sel.agent;

    if (agent.worktreeId) {
      // Worktree-aware kill dialog with 3 options
      const bridge = (globalThis as Record<string, any>).__tawtui;
      if (!bridge?.destroySessionWithWorktree) return;

      dialog.show(
        () => (
          <DialogSelect
            title={`Kill agent "${agent.name}"?`}
            options={[
              { label: 'Kill + remove worktree', value: 'kill-remove' },
              { label: 'Kill only (keep worktree)', value: 'kill-keep' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onSelect={async (value: string) => {
              dialog.close();
              if (value === 'cancel') return;
              try {
                await bridge.destroySessionWithWorktree(
                  agent.id,
                  value === 'kill-remove',
                );
              } catch {
                showError('Failed to destroy session');
              }
              loadAgents();
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'small' },
      );
    } else {
      // Simple confirm for non-worktree agents
      dialog.show(
        () => (
          <DialogConfirm
            message={`Kill agent "${agent.name}"?`}
            onConfirm={async () => {
              dialog.close();
              try {
                await ts.destroySession(agent.id);
              } catch {
                showError('Failed to destroy session');
              }
              loadAgents();
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'small' },
      );
    }
  }

  function showProjectAgentConfigDialog(): void {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return;

    const projectKey = `${sel.repo.owner}/${sel.repo.repo}`;
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!bridge?.setProjectAgentConfig) return;

    dialog.show(
      () => (
        <DialogProjectAgentConfig
          projectKey={projectKey}
          onConfirm={(cfg: ProjectAgentConfig) => {
            dialog.close();
            bridge.setProjectAgentConfig(cfg);
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'large' },
    );
  }

  function openPrDetailDialog(): void {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return;

    const repo = sel.repo;
    const prList = prs();
    const pr = prList[prIndex()];
    if (!pr) return;

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

    gh.getPR(repo.owner, repo.repo, pr.number)
      .then((detail: PullRequestDetail) => {
        const activeAgentForPr = agents().find(
          (a) =>
            a.prNumber === pr.number &&
            a.repoOwner === repo.owner &&
            a.repoName === repo.repo &&
            a.status === 'running',
        );

        dialog.close();
        dialog.show(
          () => (
            <DialogPrDetail
              pr={detail}
              hasActiveAgent={!!activeAgentForPr}
              onSendToAgent={() => {
                dialog.close();
                void sendToAgent(detail, repo);
              }}
              onGoToAgent={() => {
                dialog.close();
                const agentIdx = agents().findIndex(
                  (a) => a.id === activeAgentForPr!.id,
                );
                if (agentIdx >= 0) {
                  setCursorIndex(repos().length + agentIdx);
                  setActivePane('right');
                }
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

  async function sendToAgent(
    prDetail: PullRequestDetail,
    repo: RepoConfig,
  ): Promise<void> {
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!bridge?.createPrReviewSession) return;

    dialog.show(
      () => (
        <box flexDirection="column" paddingX={1} paddingY={1}>
          <text fg={FG_DIM}>Preparing review environment...</text>
          <box height={1} />
          <text fg={FG_DIM}>
            Cloning {repo.owner}/{repo.repo} and creating worktree for PR #
            {prDetail.number}...
          </text>
        </box>
      ),
      { size: 'medium' },
    );

    try {
      // Fetch diff
      let prDiff: PrDiff | undefined;
      if (bridge.getPrDiff) {
        try {
          prDiff = await bridge.getPrDiff(
            repo.owner,
            repo.repo,
            prDetail.number,
          );
        } catch {
          // Non-fatal — proceed without diff
        }
      }

      // Get project agent config
      let projectConfig: ProjectAgentConfig | undefined;
      const projectKey = `${repo.owner}/${repo.repo}`;
      if (bridge.getProjectAgentConfig) {
        try {
          projectConfig = bridge.getProjectAgentConfig(projectKey) ?? undefined;
        } catch {
          // Non-fatal
        }
      }

      const result = await bridge.createPrReviewSession(
        prDetail.number,
        repo.owner,
        repo.repo,
        prDetail.title,
        prDetail,
        prDiff,
        projectConfig,
      );

      dialog.close();

      loadAgents();
      // Select the newly created agent by its session ID
      const ts = getTerminalService();
      if (ts && result?.sessionId) {
        const updated = ts.listSessions();
        const newIdx = updated.findIndex((a) => a.id === result.sessionId);
        if (newIdx >= 0) {
          setCursorIndex(repos().length + newIdx);
        }
      }
    } catch {
      dialog.close();
      dialog.show(
        () => (
          <box flexDirection="column" paddingX={1} paddingY={1}>
            <text fg={COLOR_ERROR}>Failed to create review agent</text>
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
    }
  }

  // ── Keyboard handling ───────────────────────────────────────────

  let lastEscTime = 0;
  let escTimer: ReturnType<typeof setTimeout> | null = null;

  useKeyboard((key) => {
    // Interactive mode: forward all keys to tmux except ESC (double-ESC exits)
    if (interactive()) {
      if (key.name === 'escape') {
        const now = Date.now();
        if (now - lastEscTime < 300) {
          if (escTimer) clearTimeout(escTimer);
          escTimer = null;
          lastEscTime = 0;
          setInteractive(false);
          return;
        }

        lastEscTime = now;
        escTimer = setTimeout(() => {
          const ts = getTerminalService();
          const sel = selectedItem();
          if (ts && sel.kind === 'agent') {
            ts.sendInput(sel.agent.id, 'escape').catch(() => {});
          }
          escTimer = null;
        }, 300);
        return;
      }

      const ts = getTerminalService();
      const sel = selectedItem();
      if (!ts || sel.kind !== 'agent') return;

      if (key.ctrl && key.name) {
        const ctrlKey = `C-${key.name}`;
        ts.sendInput(sel.agent.id, ctrlKey).catch(() => {
          setInteractive(false);
          loadAgents();
        });
        return;
      }

      const input =
        key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta
          ? key.sequence
          : (key.name ?? key.sequence ?? '');
      ts.sendInput(sel.agent.id, input).catch(() => {
        setInteractive(false);
        loadAgents();
      });
      return;
    }

    // Don't handle keys when a dialog is open
    if (dialog.isOpen()) return;

    // Setup wizard (when PR error is showing)
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
      setActivePane('left');
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      const sel = selectedItem();
      if (sel.kind === 'repo' && repos().length > 0) {
        setActivePane('right');
      } else if (sel.kind === 'agent') {
        setActivePane('right');
      }
      return;
    }

    // Within-pane navigation: j/k or Down/Up
    if (key.name === 'j' || key.name === 'down') {
      if (pane === 'left') {
        setCursorIndex((i) => Math.min(i + 1, Math.max(totalItems() - 1, 0)));
      } else if (rightPaneMode() === 'prs') {
        setPrIndex((i) => Math.min(i + 1, Math.max(prs().length - 1, 0)));
      }
      // terminal mode: no-op for j/k
      return;
    }
    if ((key.name === 'k' && !key.shift) || key.name === 'up') {
      if (pane === 'left') {
        setCursorIndex((i) => Math.max(i - 1, 0));
      } else if (rightPaneMode() === 'prs') {
        setPrIndex((i) => Math.max(i - 1, 0));
      }
      return;
    }

    // Enter: left pane → move to right; right pane + PR → open detail
    if (key.name === 'return') {
      if (pane === 'left') {
        const sel = selectedItem();
        if (sel.kind === 'agent') {
          // Enter on agent → straight to interactive mode
          setActivePane('right');
          setInteractive(true);
          return;
        }
        if (sel.kind === 'repo') {
          setActivePane('right');
        }
        return;
      }
      if (pane === 'right' && rightPaneMode() === 'prs') {
        openPrDetailDialog();
      }
      return;
    }

    // Enter interactive mode (only when agent is selected)
    if (key.name === 'i') {
      const sel = selectedItem();
      if (sel.kind === 'agent') {
        setActivePane('right');
        setInteractive(true);
      }
      return;
    }

    // New agent
    if (key.name === 'n') {
      key.stopPropagation();
      showNewAgentDialog();
      return;
    }

    // Add repo
    if (key.name === 'a') {
      showAddRepoDialog();
      return;
    }

    // Remove repo (only when repo selected)
    if (key.name === 'x') {
      const sel = selectedItem();
      if (sel.kind === 'repo') {
        showRemoveRepoDialog();
      }
      return;
    }

    // Kill agent (Shift+K, only when agent selected)
    if (key.name === 'K' || (key.shift && key.name === 'k')) {
      const sel = selectedItem();
      if (sel.kind === 'agent') {
        showKillAgentDialog();
      }
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadRepos();
      loadAgents();
      const sel = selectedItem();
      if (sel.kind === 'repo') {
        loadPRs();
      } else if (sel.kind === 'agent') {
        void refreshCapture();
      }
      return;
    }

    // Project agent config (only when repo selected)
    if (key.name === 'c') {
      const sel = selectedItem();
      if (sel.kind === 'repo') {
        showProjectAgentConfigDialog();
      }
      return;
    }
  });

  // ── Layout calculations ─────────────────────────────────────────

  const leftPaneWidth = () => {
    const termWidth = dimensions().width;
    return Math.floor(termWidth * 0.3);
  };

  const rightPaneWidth = () => {
    const termWidth = dimensions().width;
    return termWidth - leftPaneWidth();
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <Show when={error()}>
        <box height={1}>
          <text fg={COLOR_ERROR}> {error()}</text>
        </box>
      </Show>
      <box flexDirection="row" flexGrow={1} width="100%">
        <StackedList
          repos={repos()}
          agents={agents()}
          cursorIndex={cursorIndex()}
          isActivePane={activePane() === 'left' && !interactive()}
          width={leftPaneWidth()}
        />
        <Switch>
          <Match when={rightPaneMode() === 'prs'}>
            <PrList
              prs={prs()}
              selectedIndex={prIndex()}
              isActivePane={activePane() === 'right'}
              width={rightPaneWidth()}
              repoLabel={selectedRepoLabel()}
              loading={prLoading()}
              error={prError()}
              agents={agents()}
            />
          </Match>
          <Match when={rightPaneMode() === 'terminal'}>
            <TerminalOutput
              capture={capture()}
              isActivePane={activePane() === 'right'}
              isInteractive={interactive()}
              agentName={(() => {
                const sel = selectedItem();
                return sel.kind === 'agent' ? sel.agent.name : null;
              })()}
            />
          </Match>
        </Switch>
      </box>
    </box>
  );
}
