/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '../src/modules/config.service';
import { DEFAULT_ORACLE_CONFIG } from '../src/modules/config.types';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigService - Oracle', () => {
  let service: ConfigService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-test-'));
    service = new ConfigService();
    // Override config paths for tests (avoid cross-device rename issues):
    (service as any).configPath = join(tmpDir, 'config.json');
    (service as any).tmpPath = join(tmpDir, 'config.json.tmp');
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        repos: [],
        preferences: {
          theme: 'default',
          archiveTime: 'midnight',
          defaultFilter: 'status:pending',
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_ORACLE_CONFIG when oracle section is absent', () => {
    const config = service.getOracleConfig();
    expect(config).toEqual(DEFAULT_ORACLE_CONFIG);
  });

  it('returns stored oracle config when present', () => {
    const stored = { pollIntervalSeconds: 120, defaultProject: 'Work' };
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        repos: [],
        preferences: {
          theme: 'default',
          archiveTime: 'midnight',
          defaultFilter: 'status:pending',
        },
        oracle: stored,
      }),
    );
    const config = service.getOracleConfig();
    expect(config.pollIntervalSeconds).toBe(120);
    expect(config.defaultProject).toBe('Work');
  });

  it('updateOracleConfig merges partial updates', () => {
    service.updateOracleConfig({ pollIntervalSeconds: 60 });
    const config = service.getOracleConfig();
    expect(config.pollIntervalSeconds).toBe(60);
  });

  it('updateOracleConfig persists slack credentials', () => {
    const creds = {
      xoxcToken: 'xoxc-test-token',
      xoxdCookie: 'xoxd-test-cookie',
      teamId: 'T012AB3CD',
      teamName: 'Test Workspace',
    };
    service.updateOracleConfig({ slack: creds });
    const config = service.getOracleConfig();
    expect(config.slack).toEqual(creds);
  });
});
