import { OracleEventService } from '../../src/modules/oracle/oracle-event.service';
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

describe('OracleEventService Integration', () => {
  describe('readRejectedTasks', () => {
    it('OE-RR-1: should return empty string when rejected/ directory does not exist', () => {
      const workspaceDir = mkdtempSync(
        join(tmpdir(), 'tawtui-test-workspace-'),
      );
      // No rejected/ subdirectory created
      const service = new OracleEventService(workspaceDir, 10);
      expect(service.readRejectedTasks()).toBe('');
      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('OE-RR-2: should filter files by date window and return sorted contents', () => {
      const { workspaceDir, cleanup } = createWorkspaceWithRejected({
        '2026-04-10.md': 'task A rejected',
        '2026-04-12.md': 'task B rejected',
        '2026-04-14.md': 'task C rejected',
      });
      const service = new OracleEventService(workspaceDir, 10);
      const result = service.readRejectedTasks(new Date('2026-04-11'));

      // April 12 and 14 are >= sinceDate (April 11), April 10 is not
      expect(result).toContain('task B rejected');
      expect(result).toContain('task C rejected');
      expect(result).not.toContain('task A rejected');

      // Verify sort order: B before C
      const indexB = result.indexOf('task B rejected');
      const indexC = result.indexOf('task C rejected');
      expect(indexB).toBeLessThan(indexC);

      cleanup();
    });

    it('OE-RR-3: should leak non-date .md filenames through the filter (documents bug)', () => {
      const { workspaceDir, cleanup } = createWorkspaceWithRejected({
        '2026-04-14.md': 'valid task',
        'notes.md': 'should not be here',
        'README.txt': 'readme content',
      });
      const service = new OracleEventService(workspaceDir, 10);
      const result = service.readRejectedTasks(new Date('2026-04-01'));

      // README.txt excluded by .endsWith('.md') filter
      expect(result).not.toContain('readme content');

      // notes.md leaks through: 'notes.md'.slice(0,10) = 'notes.md'
      // and 'notes.md' >= '2026-04-01' is true because 'n' > '2'
      expect(result).toContain('should not be here');

      // Valid date file included as expected
      expect(result).toContain('valid task');

      cleanup();
    });
  });

  describe('postEvent', () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it('OE-PE-1: should succeed on first attempt with correct request shape', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
      const workspaceDir = mkdtempSync(
        join(tmpdir(), 'tawtui-test-workspace-'),
      );
      const service = new OracleEventService(workspaceDir, 10);

      const event = {
        type: 'sync-complete' as const,
        messagesStored: 5,
        channels: ['#general'],
        rejectedTasks: '',
      };
      await service.postEvent(event);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:7851',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(event),
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('OE-PE-2: should retry and succeed on third attempt', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(new Response('ok'));
      const workspaceDir = mkdtempSync(
        join(tmpdir(), 'tawtui-test-workspace-'),
      );
      const service = new OracleEventService(workspaceDir, 10);

      await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('OE-PE-3: should resolve without throwing when all retries fail', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));
      const workspaceDir = mkdtempSync(
        join(tmpdir(), 'tawtui-test-workspace-'),
      );
      const service = new OracleEventService(workspaceDir, 10);

      // Fire-and-forget: should not throw even when all attempts fail
      await expect(
        service.postEvent({ type: 'daily-digest', rejectedTasks: '' }),
      ).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('OE-PE-4: should not retry when server returns 500 (documents behavior)', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('Internal Server Error', { status: 500 }),
        );
      const workspaceDir = mkdtempSync(
        join(tmpdir(), 'tawtui-test-workspace-'),
      );
      const service = new OracleEventService(workspaceDir, 10);

      await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });

      // fetch resolved (not rejected), so postEvent treats it as success — no retry
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      rmSync(workspaceDir, { recursive: true, force: true });
    });
  });
});
