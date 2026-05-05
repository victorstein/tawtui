/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

// We need to mock fs at module level so ConfigService's direct imports can be intercepted.
// By default all mocked functions delegate to the real implementation; individual tests
// override specific functions when they need to simulate failures.
const actualFs: typeof import('fs') = jest.requireActual('fs');

const mockRenameSync = jest.fn(
  (...args: Parameters<typeof actualFs.renameSync>) =>
    actualFs.renameSync(...args),
);
const mockWriteFileSync = jest.fn(
  (...args: Parameters<typeof actualFs.writeFileSync>) =>
    actualFs.writeFileSync(...args),
);

jest.mock('fs', () => ({
  ...actualFs,
  renameSync: mockRenameSync,
  writeFileSync: mockWriteFileSync,
}));

import { ConfigService } from '../../src/modules/config.service';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AppConfig } from '../../src/modules/config.types';

function freshService(tmpDir: string): ConfigService {
  const service = new ConfigService();
  (service as any).configDir = tmpDir;
  (service as any).configPath = join(tmpDir, 'config.json');
  (service as any).tmpPath = join(tmpDir, 'config.json.tmp');
  (service as any).cachedConfig = null;
  return service;
}

describe('ConfigService - Adversarial', () => {
  let service: ConfigService;
  let tmpDir: string;

  beforeEach(() => {
    // Reset mocks to pass through to real fs
    mockRenameSync.mockImplementation(
      (...args: Parameters<typeof actualFs.renameSync>) =>
        actualFs.renameSync(...args),
    );
    mockWriteFileSync.mockImplementation(
      (...args: Parameters<typeof actualFs.writeFileSync>) =>
        actualFs.writeFileSync(...args),
    );

    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-cfg-adv-'));
    service = freshService(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe('Boundary Corruption', () => {
    // CF-BC-1
    it('should return default config when config file is empty (0 bytes)', () => {
      writeFileSync(join(tmpDir, 'config.json'), '');
      const config = service.load();
      expect(config.repos).toEqual([]);
      expect(config.preferences.theme).toBe('default');
      expect(config.preferences.archiveTime).toBe('midnight');
      expect(config.preferences.defaultFilter).toBe('status:pending');
    });

    // CF-BC-2
    it('should handle config where repos is a string instead of an array', () => {
      writeFileSync(
        join(tmpDir, 'config.json'),
        JSON.stringify({ repos: 'not-an-array' }),
      );

      // load succeeds — the merge spreads the string over defaults
      const config = service.load();
      expect(config.repos).toBe('not-an-array');

      // addRepo calls .some() on the string, which throws TypeError
      expect(() =>
        service.addRepo({
          owner: 'a',
          repo: 'b',
          url: 'https://github.com/a/b',
        }),
      ).toThrow();
    });

    // CF-BC-3
    it('should degrade gracefully when config file is a JSON array', () => {
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify([1, 2, 3]));

      service.load();
      // repos from DEFAULT_CONFIG survives because spreading an array onto
      // an object adds numeric keys but doesn't overwrite 'repos'
      expect(service.getRepos()).toEqual([]);

      // addRepo should work since repos is the default []
      service.addRepo({
        owner: 'x',
        repo: 'y',
        url: 'https://github.com/x/y',
      });
      expect(service.getRepos()).toHaveLength(1);
      expect(service.getRepos()[0]).toMatchObject({ owner: 'x', repo: 'y' });
    });

    // CF-BC-4
    it('should throw on save when rename fails and leave tmp file on disk', () => {
      // Write a valid initial config
      const initial = {
        repos: [{ owner: 'o', repo: 'r', url: 'https://github.com/o/r' }],
        preferences: {
          theme: 'default',
          archiveTime: 'midnight',
          defaultFilter: 'status:pending',
        },
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(initial));
      const loaded = service.load();

      // Make renameSync throw EPERM
      mockRenameSync.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      expect(() => service.save(loaded)).toThrow('EPERM');

      // tmp file should have been written before rename failed
      expect(existsSync(join(tmpDir, 'config.json.tmp'))).toBe(true);

      // original config should be unchanged on disk
      const diskConfig = JSON.parse(
        readFileSync(join(tmpDir, 'config.json'), 'utf-8'),
      );
      expect(diskConfig.repos).toEqual(initial.repos);
    });
  });

  describe('Cache Consistency', () => {
    // CF-CC-1
    it('should document cache/disk divergence when save fails after addRepo mutates cache', () => {
      // Write valid config to disk
      const initial = {
        repos: [],
        preferences: {
          theme: 'default',
          archiveTime: 'midnight',
          defaultFilter: 'status:pending',
        },
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(initial));

      // Populate cache
      service.load();

      // Make writeFileSync fail on the next call (the save inside addRepo)
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      // addRepo should throw from save
      expect(() =>
        service.addRepo({
          owner: 'a',
          repo: 'b',
          url: 'https://github.com/a/b',
        }),
      ).toThrow('ENOSPC');

      // Restore writeFileSync so we can read from disk via the service
      mockWriteFileSync.mockImplementation(
        (...args: Parameters<typeof actualFs.writeFileSync>) =>
          actualFs.writeFileSync(...args),
      );

      // Clear cache and re-read from disk
      (service as any).cachedConfig = null;

      // Disk should NOT have the repo (save failed before writing)
      const diskConfig = JSON.parse(
        readFileSync(join(tmpDir, 'config.json'), 'utf-8'),
      ) as AppConfig;
      expect(diskConfig.repos).toEqual([]);

      // Reload via service confirms disk state
      const reloaded = service.load();
      expect(reloaded.repos).toEqual([]);
    });

    // CF-CC-2
    it('should have empty repos after rapid addRepo then removeRepo', () => {
      service.addRepo({
        owner: 'a',
        repo: 'b',
        url: 'https://github.com/a/b',
      });
      service.removeRepo('a', 'b');

      // Read directly from disk to verify
      const diskConfig = JSON.parse(
        readFileSync(join(tmpDir, 'config.json'), 'utf-8'),
      ) as AppConfig;
      expect(diskConfig.repos).toEqual([]);
    });
  });
});
