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
    service = new OracleEventService(tmpDir);
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
});
