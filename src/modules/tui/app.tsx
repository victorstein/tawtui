import { createSignal, Match, Switch, onMount } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { TabBar } from './components/tab-bar';
import { StatusBar } from './components/status-bar';
import { TasksView } from './views/tasks-view';
import { ReposView } from './views/repos-view';
import { AgentsView } from './views/agents-view';
import { DialogProvider, useDialog } from './context/dialog';
import { DialogConfirm } from './components/dialog-confirm';
import { DialogSetupWizard } from './components/dialog-setup-wizard';
import type { DependencyService } from '../dependency.service';
import type { DependencyStatus } from '../dependency.types';

function getDependencyService(): DependencyService | null {
  return (globalThis as any).__tawtui?.dependencyService ?? null;
}

const TABS = [{ name: 'Tasks' }, { name: 'Repos' }, { name: 'Agents' }];

export function App() {
  return (
    <DialogProvider>
      <AppContent />
    </DialogProvider>
  );
}

function AppContent() {
  const renderer = useRenderer();
  const dialog = useDialog();
  const [activeTab, setActiveTab] = createSignal(0);
  const [archiveMode, setArchiveMode] = createSignal(false);
  const [inputCaptured, setInputCaptured] = createSignal(false);
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);

  // Check dependencies on startup
  onMount(() => {
    const depService = getDependencyService();
    if (!depService) return;

    void depService.checkAll().then((status: DependencyStatus) => {
      if (!status.allGood) {
        dialog.show(
          () => (
            <DialogSetupWizard
              status={status}
              onCheckAgain={() => depService.checkAll()}
              onContinue={() => {
                dialog.close();
                setRefreshTrigger((n) => n + 1);
              }}
            />
          ),
          { size: 'large' },
        );
      }
    });
  });

  useKeyboard((key) => {
    // Don't handle global keys when a dialog is open or sub-component owns input
    if (dialog.isOpen()) return;
    if (inputCaptured()) return;

    // Tab switching by number
    if (key.name === '1') {
      setActiveTab(0);
      return;
    }
    if (key.name === '2') {
      setActiveTab(1);
      return;
    }
    if (key.name === '3') {
      setActiveTab(2);
      return;
    }

    // Tab cycling
    if (key.name === 'tab' && !key.shift) {
      setActiveTab((prev) => (prev + 1) % TABS.length);
      return;
    }
    if (key.name === 'tab' && key.shift) {
      setActiveTab((prev) => (prev - 1 + TABS.length) % TABS.length);
      return;
    }

    // Quit — show confirmation dialog
    if (key.name === 'q' && !key.ctrl && !key.meta) {
      dialog.show(
        () => (
          <DialogConfirm
            message="Are you sure you want to quit?"
            onConfirm={() => {
              dialog.close();
              renderer.destroy();
              const exit = (globalThis as any).__tuiExit;
              if (typeof exit === 'function') {
                exit();
              }
            }}
            onCancel={() => dialog.close()}
          />
        ),
        { size: 'small' },
      );
      return;
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <TabBar activeTab={activeTab} tabs={TABS} />

      <box flexGrow={1} flexDirection="column">
        <Switch>
          <Match when={activeTab() === 0}>
            <TasksView
              onArchiveModeChange={(active) => setArchiveMode(active)}
              onInputCapturedChange={(captured) => setInputCaptured(captured)}
              refreshTrigger={refreshTrigger}
            />
          </Match>
          <Match when={activeTab() === 1}>
            <ReposView refreshTrigger={refreshTrigger} />
          </Match>
          <Match when={activeTab() === 2}>
            <AgentsView />
          </Match>
        </Switch>
      </box>

      <StatusBar activeTab={activeTab} archiveMode={archiveMode} />
    </box>
  );
}
