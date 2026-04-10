import { createSignal, Match, Switch, onMount, onCleanup } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { TabBar } from './components/tab-bar';
import { StatusBar } from './components/status-bar';
import type { ReviewsHintContext } from './components/status-bar';
import { TasksView } from './views/tasks-view';
import ReviewsView from './views/reviews-view';
import { CalendarView } from './views/calendar-view';
import { OracleView } from './views/oracle-view';
import { DialogProvider, useDialog } from './context/dialog';
import { ToastProvider, useToast } from './context/toast';
import { DialogConfirm } from './components/dialog-confirm';
import { DialogSetupWizard } from './components/dialog-setup-wizard';
import { getDependencyService, getSlackIngestionService, getTuiExit } from './bridge';
import type { DependencyStatus } from '../dependency.types';

const TABS = [
  { name: 'Tasks' },
  { name: 'Reviews' },
  { name: 'Calendar' },
  { name: 'Oracle' },
];

export function App() {
  return (
    <DialogProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </DialogProvider>
  );
}

function AppContent() {
  const renderer = useRenderer();
  const dialog = useDialog();
  const toast = useToast();
  const [activeTab, setActiveTab] = createSignal(0);
  const [archiveMode, setArchiveMode] = createSignal(false);
  const [inputCaptured, setInputCaptured] = createSignal(false);
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);
  const [reviewsHintCtx, setReviewsHintCtx] = createSignal<ReviewsHintContext>({
    mode: 'empty',
  });
  const [oracleReady, setOracleReady] = createSignal(false);
  const [pendingTaskUuid, setPendingTaskUuid] = createSignal<string | null>(
    null,
  );
  const [ingesting, setIngesting] = createSignal(false);
  let activeSyncToastId: number | null = null;

  // Hook up Slack ingestion status + background sync toast
  onMount(() => {
    const svc = getSlackIngestionService();
    if (!svc) return;
    setIngesting(svc.ingesting);
    svc.onStatusChange = (status: boolean) => setIngesting(status);
    svc.onIngestComplete = (result) => {
      toast.show(`Synced ${result.messagesStored} messages`, 'done');
    };
  });

  onCleanup(() => {
    const svc = getSlackIngestionService();
    if (!svc) return;
    svc.onStatusChange = null;
    svc.onIngestComplete = null;
  });

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

  function handleNavigateToTask(taskUuid: string): void {
    setPendingTaskUuid(taskUuid);
    setActiveTab(0);
  }

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
    if (key.name === '4') {
      setActiveTab(3);
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

    // Quit — show confirmation dialog (q or Ctrl+C)
    if (
      (key.name === 'q' && !key.ctrl && !key.meta) ||
      (key.name === 'c' && key.ctrl)
    ) {
      dialog.show(
        () => (
          <DialogConfirm
            message="Are you sure you want to quit?"
            onConfirm={() => {
              dialog.close();
              renderer.destroy();
              const exit = getTuiExit();
              if (exit) {
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

    // Manual Slack sync (Shift+S toggles: start or cancel)
    if ((key.name === 'S' || (key.shift && key.name === 's')) && !key.ctrl && !key.meta) {
      const svc = getSlackIngestionService();
      if (!svc) return;
      if (svc.ingesting) {
        svc.abort();
        if (activeSyncToastId !== null) {
          toast.dismiss(activeSyncToastId);
          activeSyncToastId = null;
        }
        toast.show('Sync cancelled', 'error');
        return;
      }
      const id = toast.show('Syncing...');
      activeSyncToastId = id;
      svc
        .triggerIngest((info) => {
          if (info.phase === 'listing') {
            const count = info.channelsSoFar ? ` (${info.channelsSoFar} channels)` : '';
            toast.update(id, `Fetching channel list...${count}`);
          } else if (info.phase === 'detecting') {
            const count = info.channelsSoFar ? ` (${info.channelsSoFar} active)` : '';
            toast.update(id, `Detecting active channels...${count}`);
          } else if (info.phase === 'channel') {
            const msg = info.messageCount
              ? `${info.channel} (${info.messageCount} msgs) [${info.channelIndex}/${info.totalChannels}]`
              : `${info.channel}... [${info.channelIndex}/${info.totalChannels}]`;
            toast.update(id, msg);
          } else if (info.phase === 'skipped') {
            toast.update(id, `${info.channel} (cached) [${info.channelIndex}/${info.totalChannels}]`);
          } else if (info.phase === 'waiting' && info.waitReason === 'rate-limited') {
            const secs = Math.ceil((info.waitMs ?? 0) / 1000);
            const ctx = info.channel ?? 'API';
            toast.update(id, `Rate limited (${ctx}), retrying in ${secs}s...`, 'error');
          } else if (info.phase === 'threads') {
            const count = info.messageCount
              ? `${info.channel} (${info.messageCount} threads)`
              : `${info.channel} scanning threads...`;
            toast.update(id, count);
          }
        })
        .then(
          (result) => {
            activeSyncToastId = null;
            const count = result.messagesStored;
            toast.update(
              id,
              count > 0 ? `Synced ${count} messages` : 'Up to date',
              'done',
            );
          },
          () => {
            if (activeSyncToastId === id) {
              toast.update(id, 'Sync failed', 'error');
            }
            activeSyncToastId = null;
          },
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
              navigateToTaskUuid={() => pendingTaskUuid()}
              onNavigateConsumed={() => setPendingTaskUuid(null)}
            />
          </Match>
          <Match when={activeTab() === 1}>
            <ReviewsView
              refreshTrigger={refreshTrigger}
              onInputCapturedChange={(captured) => setInputCaptured(captured)}
              onHintContextChange={(ctx) => setReviewsHintCtx(ctx)}
            />
          </Match>
          <Match when={activeTab() === 2}>
            <CalendarView
              refreshTrigger={refreshTrigger}
              onNavigateToTask={handleNavigateToTask}
            />
          </Match>
          <Match when={activeTab() === 3}>
            <OracleView
              refreshTrigger={refreshTrigger}
              onInputCapturedChange={(captured) => setInputCaptured(captured)}
              onOracleReadyChange={(ready) => setOracleReady(ready)}
              initialReady={oracleReady()}
            />
          </Match>
        </Switch>
      </box>

      <StatusBar
        activeTab={activeTab}
        archiveMode={archiveMode}
        reviewsHintCtx={reviewsHintCtx}
        oracleReady={oracleReady}
        ingesting={ingesting}
      />
    </box>
  );
}
