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
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/solid';
import type { RepoConfig } from '../../../shared/types';
import type {
  PullRequest,
  PullRequestDetail,
} from '../../github.types';
import type { GithubService } from '../../github.service';
import type { ConfigService } from '../../config.service';
import type { DependencyService } from '../../dependency.service';
import type { DependencyStatus } from '../../dependency.types';
import type { ReviewsHintContext } from '../components/status-bar';
import type { HunkReviewRecord } from '../../hunk-review.types';
import { HunkReviewPanel } from '../components/hunk-review-panel';
import StackedList from '../components/stacked-list';
import { PrList } from '../components/pr-list';
import { DialogPrDetail } from '../components/dialog-pr-detail';
import { DialogConfirm } from '../components/dialog-confirm';
import { DialogPrompt } from '../components/dialog-prompt';
import { DialogSetupWizard } from '../components/dialog-setup-wizard';
import { useDialog } from '../context/dialog';
import { ACCENT_PRIMARY, FG_DIM, COLOR_ERROR } from '../theme';

// ------------------------------------------------------------------
// Service accessors
// ------------------------------------------------------------------

function getGithubService(): GithubService | null {
  return (globalThis as Record<string, any>).__tawtui?.githubService ?? null;
}

function getConfigService(): ConfigService | null {
  return (globalThis as Record<string, any>).__tawtui?.configService ?? null;
}

function getDependencyService(): DependencyService | null {
  return (globalThis as Record<string, any>).__tawtui?.dependencyService ?? null;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Pane = 'left' | 'right';

type LeftSelection =
  | { kind: 'repo'; repo: RepoConfig; repoIndex: number }
  | { kind: 'review'; review: HunkReviewRecord; reviewIndex: number }
  | { kind: 'empty' };

interface ReviewsViewProps {
  refreshTrigger?: () => number;
  onInputCapturedChange?: (captured: boolean) => void;
  onHintContextChange?: (ctx: ReviewsHintContext) => void;
}

// Module-level cache — survives tab switches (component unmounts on tab change)
const prCache = new Map<string, PullRequest[]>();
const prCacheKey = (owner: string, repo: string) => `${owner}/${repo}`;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function ReviewsView(props: ReviewsViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();
  const renderer = useRenderer();

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
  const [prSyncing, setPrSyncing] = createSignal(false);
  const [prSyncError, setPrSyncError] = createSignal(false);
  let prLoadVersion = 0;

  // Reviews state
  const [reviews, setReviews] = createSignal<HunkReviewRecord[]>([]);

  // Spinner state
  const [spinnerFrame, setSpinnerFrame] = createSignal(0);

  // Chat input state
  const [chatInput, setChatInput] = createSignal('');

  // Chat focus state — when true, keystrokes go to chat input instead of global commands
  const [chatFocused, setChatFocused] = createSignal(false);

  // Error display state
  const [error, setError] = createSignal<string | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function showError(message: string): void {
    setError(message);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => setError(null), 5000);
  }

  // ── Derived helpers ─────────────────────────────────────────────

  const totalItems = () => repos().length + reviews().length;

  const selectedItem = (): LeftSelection => {
    const idx = cursorIndex();
    const repoList = repos();
    const reviewList = reviews();
    if (repoList.length > 0 && idx < repoList.length) {
      return { kind: 'repo', repo: repoList[idx], repoIndex: idx };
    }
    const reviewIdx = idx - repoList.length;
    if (reviewList.length > 0 && reviewIdx >= 0 && reviewIdx < reviewList.length) {
      return {
        kind: 'review',
        review: reviewList[reviewIdx],
        reviewIndex: reviewIdx,
      };
    }
    return { kind: 'empty' };
  };

  const rightPaneMode = (): 'prs' | 'review' => {
    const sel = selectedItem();
    return sel.kind === 'review' ? 'review' : 'prs';
  };

  const selectedRepoLabel = (): string | null => {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return null;
    return `${sel.repo.owner}/${sel.repo.repo}`;
  };

  // Light poll: advances spinner and re-reads registry while any review is in-flight
  const hasInflight = () =>
    reviews().some((r) => r.status === 'reviewing' || r.status === 'creating');

  createEffect(() => {
    if (!hasInflight()) return;
    const id = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      loadReviews();
    }, 200);
    onCleanup(() => clearInterval(id));
  });

  // Propagate hint context to parent (StatusBar)
  createEffect(() => {
    const sel = selectedItem();
    const pane = activePane();

    let ctx: ReviewsHintContext;
    if (pane === 'right' && rightPaneMode() === 'review' && chatFocused()) {
      ctx = { mode: 'review-chat' };
    } else if (pane === 'right') {
      ctx =
        rightPaneMode() === 'review'
          ? { mode: 'review-panel' }
          : { mode: 'prs-right' };
    } else if (sel.kind === 'repo') {
      ctx = { mode: 'repo-left' };
    } else if (sel.kind === 'review') {
      ctx = { mode: 'reviews-list' };
    } else {
      ctx = { mode: 'empty' };
    }
    props.onHintContextChange?.(ctx);
  });

  // Safety-net: when leaving the review panel, always exit chat focus
  createEffect(() => {
    if (rightPaneMode() !== 'review') {
      setChatFocused(false);
      props.onInputCapturedChange?.(false);
    }
  });

  // ── Data loading ────────────────────────────────────────────────

  function loadRepos(): void {
    const config = getConfigService();
    if (!config) return;
    const loaded = config.getRepos();
    setRepos(loaded);
    if (cursorIndex() >= loaded.length + reviews().length) {
      setCursorIndex(Math.max(loaded.length + reviews().length - 1, 0));
    }
  }

  function loadReviews(): void {
    const bridge = (globalThis as Record<string, any>).__tawtui;
    const list: HunkReviewRecord[] = bridge?.listHunkReviews?.() ?? [];
    setReviews(list);
    if (cursorIndex() >= repos().length + list.length) {
      setCursorIndex(Math.max(repos().length + list.length - 1, 0));
    }
  }

  function applyPrList(cacheKey: string, prList: PullRequest[]): void {
    prCache.set(cacheKey, prList);
    setPrs(prList);
    if (prIndex() >= prList.length) {
      setPrIndex(Math.max(prList.length - 1, 0));
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
    const cacheKey = prCacheKey(repo.owner, repo.repo);
    const cached = prCache.get(cacheKey);

    const version = ++prLoadVersion;
    setPrError(null);
    setPrIndex(0);

    if (cached !== undefined) {
      setPrs(cached);

      setPrSyncing(true);
      setPrSyncError(false);
      try {
        const prList = await gh.listPRs(repo.owner, repo.repo);
        if (version !== prLoadVersion) return;
        applyPrList(cacheKey, prList);
      } catch {
        if (version !== prLoadVersion) return;
        setPrSyncError(true);
      } finally {
        setPrSyncing(false);
      }
    } else {
      setPrSyncing(false);
      setPrSyncError(false);
      setPrLoading(true);
      setPrs([]);

      try {
        const prList = await gh.listPRs(repo.owner, repo.repo);
        if (version !== prLoadVersion) return;
        applyPrList(cacheKey, prList);
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
  }

  // ── Effects and lifecycle ───────────────────────────────────────

  // Separate effect: handle repo selection — load PRs
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
    }
  });

  onMount(() => {
    loadRepos();
    loadReviews();
  });

  onCleanup(() => {
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  });

  // Reload when parent bumps refreshTrigger
  createEffect(
    on(
      () => props.refreshTrigger?.(),
      () => {
        prCache.clear();
        loadRepos();
        loadReviews();
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
            prCache.delete(prCacheKey(repo.owner, repo.repo));
            config.removeRepo(repo.owner, repo.repo);
            loadRepos();
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'small' },
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
        dialog.close();
        dialog.show(
          () => (
            <DialogPrDetail
              pr={detail}
              onSendToAgent={() => {
                dialog.close();
                void startHunkReviewFlow();
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

  // ── Hunk review actions ─────────────────────────────────────────

  async function startHunkReviewFlow(): Promise<void> {
    const sel = selectedItem();
    if (sel.kind !== 'repo') return;
    const pr = prs()[prIndex()];
    if (!pr) return;
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!bridge?.startHunkReview || !bridge?.checkHunkPrereqs) return;

    const prereqs = await bridge.checkHunkPrereqs();
    if (!prereqs.hunk.available) {
      showError(`hunk not available: ${prereqs.hunk.detail}`);
      return;
    }
    if (!prereqs.claudeAuth) {
      showError('Claude auth missing — run `claude login`');
      return;
    }

    try {
      const { prKey } = await bridge.startHunkReview(sel.repo.owner, sel.repo.repo, pr.number, pr.title);
      loadReviews();
      const idx = reviews().findIndex((r) => r.prKey === prKey);
      if (idx >= 0) setCursorIndex(repos().length + idx);
    } catch (err) {
      showError(`Hunk review failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function openHunkForeground(r: HunkReviewRecord): Promise<void> {
    if (r.status !== 'ready' || !r.agentContextPath || !r.patchPath) return;
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!bridge?.runHunkForeground) return;
    await bridge.runHunkForeground(
      { worktreePath: r.worktreePath, patchPath: r.patchPath, agentContextPath: r.agentContextPath, port: r.port },
      { suspend: () => renderer.suspend(), resume: () => renderer.resume() },
    );
  }

  async function sendChat(prKey: string): Promise<void> {
    const msg = chatInput().trim();
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!msg || !bridge?.askHunkChat) return;
    setChatInput('');
    try {
      await bridge.askHunkChat(prKey, msg);
    } catch {
      showError('Chat failed');
    } finally {
      loadReviews();
    }
  }

  function killSelectedReview(): void {
    const sel = selectedItem();
    if (sel.kind !== 'review') return;
    const r = sel.review;
    const bridge = (globalThis as Record<string, any>).__tawtui;
    if (!bridge?.killHunkReview) return;
    dialog.show(
      () => (
        <DialogConfirm
          message={`Remove review for PR #${r.prNumber}?`}
          onConfirm={async () => {
            dialog.close();
            try { await bridge.killHunkReview(r.prKey); } catch { showError('Failed to remove review'); }
            loadReviews();
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'small' },
    );
  }

  // ── Keyboard handling ───────────────────────────────────────────

  useKeyboard((key) => {
    // Alt+C: Copy selected text to clipboard
    if ((key.option && key.name === 'c') || key.sequence === 'ç') {
      const selection = renderer.getSelection();
      if (selection && selection.isActive) {
        const text = selection.getSelectedText();
        if (text) {
          renderer.copyToClipboardOSC52(text);
          renderer.clearSelection();
        }
      }
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

    // Chat input capture — MUST run before any generic command handlers so that
    // typing 'q', 'x', 'o', etc. inserts text rather than triggering actions.
    if (pane === 'right' && rightPaneMode() === 'review' && chatFocused()) {
      if (key.name === 'escape') {
        setChatFocused(false);
        props.onInputCapturedChange?.(false);
        return;
      }
      if (key.name === 'return') {
        const sel = selectedItem();
        if (sel.kind === 'review') {
          void sendChat(sel.review.prKey);
        }
        return;
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        setChatInput((s) => s.slice(0, -1));
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setChatInput((s) => s + key.sequence);
        return;
      }
      // Swallow all other keys while in chat mode
      return;
    }

    // Pane switching: h/l or Left/Right (let Shift+H fall through to the hunk-review handler)
    if ((key.name === 'h' && !key.shift) || key.name === 'left') {
      setActivePane('left');
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      const sel = selectedItem();
      if (sel.kind === 'repo' && repos().length > 0) {
        setActivePane('right');
      } else if (sel.kind === 'review') {
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

    // Enter / l on left pane: navigate right; Enter on right pane + PRs: open detail
    if (key.name === 'return') {
      if (pane === 'left') {
        const sel = selectedItem();
        if (sel.kind === 'repo' || sel.kind === 'review') {
          setActivePane('right');
        }
        return;
      }
      if (pane === 'right') {
        if (rightPaneMode() === 'prs') {
          openPrDetailDialog();
        }
      }
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

    // K: kill/remove selected review
    if (key.name === 'K' || (key.shift && key.name === 'k')) {
      const sel = selectedItem();
      if (sel.kind === 'review') {
        killSelectedReview();
      }
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadRepos();
      loadReviews();
      const sel = selectedItem();
      if (sel.kind === 'repo') {
        setPrSyncError(false);
        prCache.delete(prCacheKey(sel.repo.owner, sel.repo.repo));
        loadPRs();
      }
      return;
    }

    // Hunk review: Shift+H → start/dedup, o → open foreground, Esc → back to list
    if (key.name === 'escape') {
      if (pane === 'right') {
        setActivePane('left');
      }
      return;
    }

    if (key.name === 'H' || (key.shift && key.name === 'h')) {
      if (rightPaneMode() === 'prs') {
        void startHunkReviewFlow();
      }
      return;
    }

    if (key.name === 'o') {
      const sel = selectedItem();
      if (sel.kind === 'review') {
        void openHunkForeground(sel.review);
      }
      return;
    }

    // Enter chat mode when in the review panel
    if (key.name === 'i' && pane === 'right' && rightPaneMode() === 'review') {
      setChatFocused(true);
      props.onInputCapturedChange?.(true);
      return;
    }
  });

  // ── Layout calculations ─────────────────────────────────────────

  const leftPaneWidth = () => Math.floor(dimensions().width * 0.3);

  const rightPaneWidth = () => dimensions().width - leftPaneWidth();

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
          reviews={reviews()}
          spinnerFrame={spinnerFrame()}
          cursorIndex={cursorIndex()}
          isActivePane={activePane() === 'left'}
          width={leftPaneWidth()}
        />
        <Switch>
          <Match when={rightPaneMode() === 'review'}>
            {(() => {
              const sel = selectedItem();
              if (sel.kind !== 'review') return null;
              const r = sel.review;
              return (
                <HunkReviewPanel
                  summary={r.body?.summary ?? (r.status === 'error' || r.status === 'interrupted' ? (r.error ?? 'Review failed') : 'Reviewing…')}
                  unanchored={r.body?.unanchoredFindings ?? []}
                  unanchoredCount={r.body?.unanchoredCount ?? 0}
                  chat={r.chat}
                  status={r.status}
                  error={r.error}
                  chatInput={chatInput()}
                  onChatInput={setChatInput}
                  onSend={() => void sendChat(r.prKey)}
                  onOpenHunk={() => void openHunkForeground(r)}
                />
              );
            })()}
          </Match>
          <Match when={rightPaneMode() === 'prs'}>
            <box flexDirection="column" flexGrow={1}>
              <PrList
                prs={prs()}
                selectedIndex={prIndex()}
                isActivePane={activePane() === 'right'}
                width={rightPaneWidth()}
                repoLabel={selectedRepoLabel()}
                loading={prLoading()}
                error={prError()}
                syncing={prSyncing()}
                syncError={prSyncError()}
              />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  );
}
