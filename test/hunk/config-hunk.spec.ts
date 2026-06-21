/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '../../src/modules/config.service';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function freshService(dir: string): ConfigService {
  const s = new ConfigService();
  (s as any).configDir = dir;
  (s as any).configPath = join(dir, 'config.json');
  (s as any).tmpPath = join(dir, 'config.json.tmp');
  (s as any).cachedConfig = null;
  return s;
}

describe('ConfigService - hunk', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tawtui-hunk-cfg-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('getHunkConfig', () => {
    it('should return defaults when no config file exists', () => {
      const cfg = freshService(dir).getHunkConfig();
      expect(cfg.binaryPath).toBeUndefined();
      expect(cfg.autodetect).toBe(true);
      expect(cfg.agentAuthorLabel).toBe('tawtui-review');
      expect(cfg.maxDiffBytes).toBe(1_500_000);
    });

    it('should merge persisted partial config over defaults', () => {
      writeFileSync(
        join(dir, 'config.json'),
        JSON.stringify({ hunk: { maxDiffBytes: 42 } }),
      );
      const cfg = freshService(dir).getHunkConfig();
      expect(cfg.maxDiffBytes).toBe(42);
      expect(cfg.agentAuthorLabel).toBe('tawtui-review');
    });
  });

  describe('updateHunkConfig', () => {
    it('should persist a partial update and round-trip it', () => {
      const s = freshService(dir);
      s.updateHunkConfig({ binaryPath: '/usr/local/bin/hunk' });
      expect(freshService(dir).getHunkConfig().binaryPath).toBe(
        '/usr/local/bin/hunk',
      );
    });
  });
});
