import { OracleEventService } from '../src/modules/oracle/oracle-event.service';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('OracleEventService', () => {
  let service: OracleEventService;
  let tmpDir: string;
  let rejectedDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oracle-event-test-'));
    rejectedDir = join(tmpDir, 'rejected');
    mkdirSync(rejectedDir, { recursive: true });
    service = new OracleEventService(tmpDir, 0);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe('readRejectedTasks', () => {
    it('returns empty string when rejected/ does not exist', () => {
      rmSync(rejectedDir, { recursive: true });
      expect(service.readRejectedTasks()).toBe('');
    });

    it('returns empty string when rejected/ is empty', () => {
      expect(service.readRejectedTasks()).toBe('');
    });

    it('reads files within the date window', () => {
      writeFileSync(join(rejectedDir, '2026-04-10.md'), 'rejected task A\n');
      writeFileSync(join(rejectedDir, '2026-04-11.md'), 'rejected task B\n');
      // Set window: last 7 days from 2026-04-11
      const result = service.readRejectedTasks(new Date('2026-04-04'));
      expect(result).toContain('rejected task A');
      expect(result).toContain('rejected task B');
    });

    it('excludes files outside the date window', () => {
      writeFileSync(join(rejectedDir, '2026-03-01.md'), 'old rejection\n');
      writeFileSync(join(rejectedDir, '2026-04-11.md'), 'recent rejection\n');
      const result = service.readRejectedTasks(new Date('2026-04-10'));
      expect(result).not.toContain('old rejection');
      expect(result).toContain('recent rejection');
    });

    it('defaults to 7 days ago when no sinceDate provided', () => {
      // A file from today should always be included
      const today = new Date().toISOString().split('T')[0];
      writeFileSync(join(rejectedDir, `${today}.md`), 'today rejection\n');
      expect(service.readRejectedTasks()).toContain('today rejection');
    });
  });

  describe('postEvent', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('POSTs event payload to the channel server', async () => {
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

    it('retries on connection refused (up to 3 attempts)', async () => {
      const connErr = new TypeError('fetch failed');
      fetchSpy
        .mockRejectedValueOnce(connErr)
        .mockRejectedValueOnce(connErr)
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await service.postEvent({ type: 'daily-digest', rejectedTasks: '' });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('does not throw when all retries fail', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        service.postEvent({ type: 'daily-digest', rejectedTasks: '' }),
      ).resolves.toBeUndefined();
    });
  });
});
