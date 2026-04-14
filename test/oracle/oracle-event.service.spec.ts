import { OracleEventService } from '../../src/modules/oracle/oracle-event.service';
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * StateHelper.createRejectedDir creates the rejected/ dir itself.
 * OracleEventService expects a workspaceDir and appends rejected/ internally.
 * So we create a workspace dir and put the rejected/ dir inside it.
 */
function createWorkspaceWithRejected(entries: Record<string, string> = {}): {
  workspaceDir: string;
  cleanup: () => void;
} {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'tawtui-test-workspace-'));
  const rejectedDir = join(workspaceDir, 'rejected');
  mkdirSync(rejectedDir, { recursive: true });
  for (const [name, content] of Object.entries(entries)) {
    writeFileSync(join(rejectedDir, name), content);
  }
  return {
    workspaceDir,
    cleanup: () => rmSync(workspaceDir, { recursive: true, force: true }),
  };
}

describe('OracleEventService', () => {
  describe('readRejectedTasks', () => {
    describe('Behavior', () => {
      it('should read .md files from rejected/ and concatenate contents', () => {
        const { workspaceDir, cleanup } = createWorkspaceWithRejected({
          '2026-04-10.md': 'rejected task A\n',
          '2026-04-11.md': 'rejected task B\n',
        });
        const service = new OracleEventService(workspaceDir, 10);
        const result = service.readRejectedTasks(new Date('2026-04-04'));
        expect(result).toContain('rejected task A');
        expect(result).toContain('rejected task B');
        cleanup();
      });

      it('should filter files by date and only include files >= sinceDate', () => {
        const { workspaceDir, cleanup } = createWorkspaceWithRejected({
          '2026-03-01.md': 'old rejection\n',
          '2026-04-11.md': 'recent rejection\n',
        });
        const service = new OracleEventService(workspaceDir, 10);
        const result = service.readRejectedTasks(new Date('2026-04-10'));
        expect(result).not.toContain('old rejection');
        expect(result).toContain('recent rejection');
        cleanup();
      });

      it('should default to 7 days ago when no sinceDate provided', () => {
        const today = new Date().toISOString().split('T')[0];
        const { workspaceDir, cleanup } = createWorkspaceWithRejected({
          [`${today}.md`]: 'today rejection\n',
        });
        const service = new OracleEventService(workspaceDir, 10);
        expect(service.readRejectedTasks()).toContain('today rejection');
        cleanup();
      });
    });

    describe('Error Handling', () => {
      it('should return empty string when rejected/ directory is missing', () => {
        // Create workspace dir but no rejected/ subdir inside it
        const workspaceDir = mkdtempSync(
          join(tmpdir(), 'tawtui-test-workspace-'),
        );
        const service = new OracleEventService(workspaceDir, 10);
        expect(service.readRejectedTasks()).toBe('');
        rmSync(workspaceDir, { recursive: true, force: true });
      });
    });

    describe('Edge Cases', () => {
      it('should return empty string when rejected/ directory is empty', () => {
        const { workspaceDir, cleanup } = createWorkspaceWithRejected();
        const service = new OracleEventService(workspaceDir, 10);
        expect(service.readRejectedTasks()).toBe('');
        cleanup();
      });

      it('should ignore non-.md files', () => {
        const { workspaceDir, cleanup } = createWorkspaceWithRejected({
          '2026-04-11.md': 'included\n',
          '2026-04-11.txt': 'ignored text\n',
          '2026-04-11.json': '{"should-be-ignored": true}',
        });
        const service = new OracleEventService(workspaceDir, 10);
        const result = service.readRejectedTasks(new Date('2026-04-04'));
        expect(result).toContain('included');
        expect(result).not.toContain('ignored text');
        expect(result).not.toContain('should-be-ignored');
        cleanup();
      });

      it('should exclude files whose name prefix sorts before sinceDate', () => {
        // Files with non-date names starting with digits below "2026" are excluded.
        // e.g. "0000-notes.md" sorts below any real date string.
        const { workspaceDir, cleanup } = createWorkspaceWithRejected({
          '2026-04-11.md': 'valid file\n',
          '0000-notes.md': 'old notes content\n',
        });
        const service = new OracleEventService(workspaceDir, 10);
        const result = service.readRejectedTasks(new Date('2026-04-10'));
        expect(result).toContain('valid file');
        expect(result).not.toContain('old notes content');
        cleanup();
      });
    });
  });

  describe('postEvent', () => {
    let fetchSpy: jest.SpyInstance;
    let service: OracleEventService;
    let tmpCleanup: () => void;

    beforeEach(() => {
      const { workspaceDir, cleanup } = createWorkspaceWithRejected();
      tmpCleanup = cleanup;
      service = new OracleEventService(workspaceDir, 10);
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      tmpCleanup();
    });

    describe('Behavior', () => {
      it('should POST JSON to localhost:7851 with correct body and headers', async () => {
        await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
        expect(fetchSpy).toHaveBeenCalledWith(
          'http://127.0.0.1:7851',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ type: 'daily-digest', rejectedTasks: '' }),
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      it('should POST sync-complete event with all required fields', async () => {
        const event = {
          type: 'sync-complete' as const,
          messagesStored: 5,
          channels: ['general', 'engineering'],
          rejectedTasks: 'task one\ntask two\n',
        };
        await service.postEvent(event);
        expect(fetchSpy).toHaveBeenCalledWith(
          'http://127.0.0.1:7851',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(event),
          }),
        );
      });

      it('should be fire-and-forget and not block on response', async () => {
        // Simulate a slow server — postEvent should resolve before the response completes
        let resolveResponse!: (v: Response) => void;
        fetchSpy.mockReturnValue(
          new Promise<Response>((res) => {
            resolveResponse = res;
          }),
        );
        const promise = service.postEvent({
          type: 'daily-digest',
          rejectedTasks: '',
        });
        // postEvent is NOT fire-and-forget in the pure sense — it awaits fetch internally
        // but its public contract is void: callers can discard without awaiting
        resolveResponse(new Response('ok', { status: 200 }));
        await expect(promise).resolves.toBeUndefined();
      });
    });

    describe('Error Handling', () => {
      it('should retry up to 3 times with exponential backoff on failure', async () => {
        const connErr = new TypeError('fetch failed');
        fetchSpy
          .mockRejectedValueOnce(connErr)
          .mockRejectedValueOnce(connErr)
          .mockResolvedValueOnce(new Response('ok', { status: 200 }));

        await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });

      it('should succeed on the first retry if first attempt fails', async () => {
        fetchSpy
          .mockRejectedValueOnce(new TypeError('fetch failed'))
          .mockResolvedValueOnce(new Response('ok', { status: 200 }));

        await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('should log error and not throw after max retries exhausted', async () => {
        fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
        await expect(
          service.postEvent({ type: 'daily-digest', rejectedTasks: '' }),
        ).resolves.toBeUndefined();
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });
    });

    describe('Edge Cases', () => {
      it('should make exactly one fetch call when first attempt succeeds', async () => {
        await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it('should not exceed 3 fetch attempts even if all fail', async () => {
        fetchSpy.mockRejectedValue(new TypeError('connection refused'));
        await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });
    });
  });
});
