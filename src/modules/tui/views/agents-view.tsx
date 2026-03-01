import { createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { TerminalSession, CaptureResult } from '../../terminal.types';
import { AgentList } from '../components/agent-list';
import { TerminalOutput } from '../components/terminal-output';
import { useDialog } from '../context/dialog';
import { DialogConfirm } from '../components/dialog-confirm';
import { AgentForm } from '../components/agent-form';
import { getTerminalService } from '../bridge';
import { COLOR_ERROR } from '../theme';

/** Pane identifiers for the split-pane layout. */
type Pane = 'agents' | 'terminal';

interface AgentsViewProps {
  onInputCapturedChange?: (captured: boolean) => void;
}

export function AgentsView(props: AgentsViewProps) {
  const dimensions = useTerminalDimensions();
  const dialog = useDialog();

  // Pane state
  const [activePane, setActivePane] = createSignal<Pane>('agents');

  // Agent list state
  const [agents, setAgents] = createSignal<TerminalSession[]>([]);
  const [agentIndex, setAgentIndex] = createSignal(0);

  // Terminal output state
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

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  /** Refresh the agent list from TerminalService. */
  function loadAgents(): void {
    const ts = getTerminalService();
    if (!ts) return;
    const sessions = ts.listSessions();
    setAgents(sessions);
    // Clamp selection
    if (agentIndex() >= sessions.length) {
      setAgentIndex(Math.max(sessions.length - 1, 0));
    }
  }

  /** Get the currently selected agent (if any). */
  function selectedAgent(): TerminalSession | null {
    const list = agents();
    const idx = agentIndex();
    return list[idx] ?? null;
  }

  /** Capture terminal output for the selected agent. */
  async function refreshCapture(): Promise<void> {
    const ts = getTerminalService();
    const agent = selectedAgent();
    if (!ts || !agent) {
      setCapture(null);
      return;
    }
    try {
      const result = await ts.captureOutput(agent.id);
      if (result.changed || capture() === null) {
        setCapture(result);
      }
    } catch {
      loadAgents();
      setCapture(null);
    }
  }

  /** Resize the tmux pane to match the output pane dimensions. */
  async function resizeTmuxPane(): Promise<void> {
    const ts = getTerminalService();
    const agent = selectedAgent();
    if (!ts || !agent) return;

    const termWidth = dimensions().width;
    const termHeight = dimensions().height;
    const outputWidth = termWidth - Math.floor(termWidth * 0.3);
    const cols = Math.max(outputWidth - 4, 10);
    const rows = Math.max(termHeight - 8, 5);

    try {
      await ts.resize(agent.id, cols, rows);
    } catch {
      // Ignore resize errors
    }
  }

  // ------------------------------------------------------------------
  // Poll overlap guard
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Adaptive polling
  // ------------------------------------------------------------------

  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  function getPollInterval(): number {
    if (agents().length === 0) return 2000;
    if (interactive()) return 80;
    if (activePane() === 'terminal') return 200;
    return 500;
  }

  function schedulePoll(): void {
    pollTimer = setTimeout(() => {
      void doPoll().then(() => schedulePoll());
    }, getPollInterval());
  }

  // ------------------------------------------------------------------
  // Effects and lifecycle
  // ------------------------------------------------------------------

  // Consolidated resize effect with debounce
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    // Track all relevant reactive dependencies
    const list = agents();
    const idx = agentIndex();
    dimensions(); // re-run on terminal resize

    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }

    if (list.length > 0 && idx < list.length) {
      setCapture(null);
      void refreshCapture();
      // Debounce resize by 50ms
      resizeTimer = setTimeout(() => {
        void resizeTmuxPane();
      }, 50);
    } else {
      setCapture(null);
    }
  });

  // Restart polling when relevant state changes
  createEffect(() => {
    // Track reactive dependencies
    interactive();
    activePane();
    void agents().length;
    // Restart polling with new interval
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
    }
    schedulePoll();
  });

  onMount(() => {
    loadAgents();
    schedulePoll();
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

  // ------------------------------------------------------------------
  // Dialogs
  // ------------------------------------------------------------------

  /** Show dialog to create a new agent. */
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

              loadAgents();
              const updated = ts.listSessions();
              const newIdx = updated.findIndex((s) => s.id === session.id);
              if (newIdx >= 0) {
                setAgentIndex(newIdx);
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

  /** Show dialog to kill the selected agent. */
  function showKillAgentDialog(): void {
    const agent = selectedAgent();
    if (!agent) return;
    const ts = getTerminalService();
    if (!ts) return;

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

  // ------------------------------------------------------------------
  // Keyboard handling
  // ------------------------------------------------------------------

  let lastEscTime = 0;
  let escTimer: ReturnType<typeof setTimeout> | null = null;

  useKeyboard((key) => {
    // When in interactive mode, forward everything to tmux except ESC
    if (interactive()) {
      if (key.name === 'escape') {
        const now = Date.now();
        if (now - lastEscTime < 300) {
          // Double-ESC: exit interactive mode
          if (escTimer) clearTimeout(escTimer);
          escTimer = null;
          lastEscTime = 0;
          setInteractive(false);
          return;
        }

        lastEscTime = now;
        // Start timer: if no second ESC within 300ms, forward ESC to tmux
        escTimer = setTimeout(() => {
          const ts = getTerminalService();
          const agent = selectedAgent();
          if (ts && agent) {
            ts.sendInput(agent.id, 'escape').catch(() => {});
          }
          escTimer = null;
        }, 300);
        return;
      }

      const ts = getTerminalService();
      const agent = selectedAgent();
      if (!ts || !agent) return;

      // Handle ctrl combinations
      if (key.ctrl && key.name) {
        const ctrlKey = `C-${key.name}`;
        ts.sendInput(agent.id, ctrlKey).catch(() => {
          setInteractive(false);
          loadAgents();
        });
        return;
      }

      // Forward the key — prefer key.sequence for printable chars to preserve
      // case and special characters (e.g. '@', '!', uppercase letters).
      const input =
        key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta
          ? key.sequence
          : (key.name ?? key.sequence ?? '');
      ts.sendInput(agent.id, input).catch(() => {
        setInteractive(false);
        loadAgents();
      });
      return;
    }

    // Don't handle keys when a dialog is open
    if (dialog.isOpen()) return;

    // Pane switching: h/l or Left/Right
    if (key.name === 'h' || key.name === 'left') {
      setActivePane('agents');
      return;
    }
    if (key.name === 'l' || key.name === 'right') {
      if (agents().length > 0) {
        setActivePane('terminal');
      }
      return;
    }

    // Within-pane navigation: j/k or Down/Up (only in agents pane)
    if (key.name === 'j' || key.name === 'down') {
      if (activePane() === 'agents') {
        setAgentIndex((i) => Math.min(i + 1, Math.max(agents().length - 1, 0)));
      }
      return;
    }
    if ((key.name === 'k' && !key.shift) || key.name === 'up') {
      if (activePane() === 'agents') {
        setAgentIndex((i) => Math.max(i - 1, 0));
      }
      return;
    }

    // Enter interactive mode
    if (key.name === 'i') {
      const agent = selectedAgent();
      if (agent) {
        setActivePane('terminal');
        setInteractive(true);
      }
      return;
    }

    // Kill agent (Shift+K)
    if (key.name === 'K' || (key.shift && key.name === 'k')) {
      showKillAgentDialog();
      return;
    }

    // Refresh
    if (key.name === 'r') {
      loadAgents();
      void refreshCapture();
      return;
    }

    // New agent
    if (key.name === 'n') {
      key.stopPropagation();
      showNewAgentDialog();
      return;
    }
  });

  // ------------------------------------------------------------------
  // Layout calculations
  // ------------------------------------------------------------------

  const agentPaneWidth = () => {
    const termWidth = dimensions().width;
    return Math.floor(termWidth * 0.3);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <Show when={error()}>
        <box height={1}>
          <text fg={COLOR_ERROR}> {error()}</text>
        </box>
      </Show>
      <box flexDirection="row" flexGrow={1} width="100%">
        <AgentList
          agents={agents()}
          selectedIndex={agentIndex()}
          isActivePane={activePane() === 'agents' && !interactive()}
          width={agentPaneWidth()}
        />
        <TerminalOutput
          capture={capture()}
          isActivePane={activePane() === 'terminal'}
          isInteractive={interactive()}
          agentName={selectedAgent()?.name ?? null}
        />
      </box>
    </box>
  );
}
