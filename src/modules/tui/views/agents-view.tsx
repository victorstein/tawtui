import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { TerminalSession, CaptureResult } from '../../terminal.types';
import type { TerminalService } from '../../terminal.service';
import { AgentList } from '../components/agent-list';
import { TerminalOutput } from '../components/terminal-output';
import { useDialog } from '../context/dialog';
import { DialogConfirm } from '../components/dialog-confirm';
import { DialogPrompt } from '../components/dialog-prompt';

/**
 * Access the TerminalService bridged from NestJS DI via globalThis.
 */
function getTerminalService(): TerminalService | null {
  return (globalThis as any).__tawtui?.terminalService ?? null;
}

/** Pane identifiers for the split-pane layout. */
type Pane = 'agents' | 'terminal';

export function AgentsView() {
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
  function refreshCapture(): void {
    const ts = getTerminalService();
    const agent = selectedAgent();
    if (!ts || !agent) {
      setCapture(null);
      return;
    }
    try {
      const result = ts.captureOutput(agent.id);
      if (result.changed || capture() === null) {
        setCapture(result);
      }
    } catch {
      // Session may have been destroyed; refresh agent list
      loadAgents();
      setCapture(null);
    }
  }

  /** Resize the tmux pane to match the output pane dimensions. */
  function resizeTmuxPane(): void {
    const ts = getTerminalService();
    const agent = selectedAgent();
    if (!ts || !agent) return;

    // Terminal output pane: 70% of terminal width minus borders (2 chars for border)
    // Height: full height minus tab bar (1), status bar (1), header (1), separator (1), cursor line (1), borders (2)
    const termWidth = dimensions().width;
    const termHeight = dimensions().height;
    const outputWidth = termWidth - Math.floor(termWidth * 0.3);
    const cols = Math.max(outputWidth - 4, 10); // subtract borders and padding
    const rows = Math.max(termHeight - 8, 5); // subtract chrome

    try {
      ts.resize(agent.id, cols, rows);
    } catch {
      // Ignore resize errors (session may be gone)
    }
  }

  // ------------------------------------------------------------------
  // Effects and lifecycle
  // ------------------------------------------------------------------

  // When the selected agent changes, reset capture and resize
  createEffect(() => {
    const list = agents();
    const idx = agentIndex();
    if (list.length > 0 && idx < list.length) {
      setCapture(null);
      refreshCapture();
      resizeTmuxPane();
    } else {
      setCapture(null);
    }
  });

  // Resize tmux pane when terminal dimensions change
  createEffect(() => {
    // Track dimensions so the effect re-runs on resize
    dimensions();
    resizeTmuxPane();
  });

  // Polling timer for terminal output (200ms)
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    loadAgents();
    pollTimer = setInterval(() => {
      refreshCapture();
    }, 200);
  });

  onCleanup(() => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
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
        <DialogPrompt
          title="New Agent - Enter command (or leave empty for shell)"
          placeholder="e.g. htop, npm run dev, bash"
          onSubmit={(value: string) => {
            dialog.close();
            const command = value.trim() || undefined;
            const name = command ?? 'shell';
            try {
              const session = ts.createSession({
                name,
                cwd: process.cwd(),
                command,
              });
              loadAgents();
              // Select the newly created agent
              const updated = ts.listSessions();
              const newIdx = updated.findIndex((s) => s.id === session.id);
              if (newIdx >= 0) {
                setAgentIndex(newIdx);
              }
            } catch {
              // Session creation failed — ignore for now
            }
          }}
          onCancel={() => dialog.close()}
        />
      ),
      { size: 'medium' },
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
          onConfirm={() => {
            dialog.close();
            try {
              ts.destroySession(agent.id);
            } catch {
              // Already gone
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

  useKeyboard((key) => {
    // When in interactive mode, forward everything to tmux except ESC
    if (interactive()) {
      if (key.name === 'escape') {
        setInteractive(false);
        return;
      }

      const ts = getTerminalService();
      const agent = selectedAgent();
      if (!ts || !agent) return;

      try {
        // Handle ctrl combinations
        if (key.ctrl && key.name) {
          const ctrlKey = `C-${key.name}`;
          ts.sendInput(agent.id, ctrlKey);
          return;
        }

        // Forward the key name (sendInput handles key mapping internally)
        ts.sendInput(agent.id, key.name ?? key.sequence ?? '');
      } catch {
        // Session gone; exit interactive mode
        setInteractive(false);
        loadAgents();
      }
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
    if (key.name === 'k' || key.name === 'up') {
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
      refreshCapture();
      return;
    }

    // New agent
    if (key.name === 'n') {
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
