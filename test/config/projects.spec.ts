import { ConfigService } from '../../src/modules/config.service';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AppConfig } from '../../src/modules/config.types';

function freshService(tmpDir: string): ConfigService {
  const service = new ConfigService();
  (service as unknown as { configDir: string }).configDir = tmpDir;
  (service as unknown as { configPath: string }).configPath = join(
    tmpDir,
    'config.json',
  );
  (service as unknown as { tmpPath: string }).tmpPath = join(
    tmpDir,
    'config.json.tmp',
  );
  (service as unknown as { cachedConfig: AppConfig | null }).cachedConfig =
    null;
  return service;
}

describe('ConfigService - persisted projects', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-projects-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('defaults projects to an empty array when no config file exists', () => {
    const service = freshService(tmpDir);
    expect(service.getPersistedProjects()).toEqual([]);
  });

  it('merges projects: [] into an existing config file that lacks the field', () => {
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({ repos: [], preferences: {} }),
    );
    const service = freshService(tmpDir);
    expect(service.getPersistedProjects()).toEqual([]);
  });

  it('adds a project and persists it to disk (deduped)', () => {
    const service = freshService(tmpDir);
    service.addPersistedProject('Work');
    service.addPersistedProject('Work');
    expect(service.getPersistedProjects()).toEqual(['Work']);
    const onDisk = JSON.parse(
      readFileSync(join(tmpDir, 'config.json'), 'utf-8'),
    ) as AppConfig;
    expect(onDisk.projects).toEqual(['Work']);
  });

  it('removes a persisted project', () => {
    const service = freshService(tmpDir);
    service.addPersistedProject('Work');
    service.addPersistedProject('Home');
    service.removePersistedProject('Work');
    expect(service.getPersistedProjects()).toEqual(['Home']);
  });

  it('reloads persisted projects from disk in a fresh service instance', () => {
    const a = freshService(tmpDir);
    a.addPersistedProject('Work');
    const b = freshService(tmpDir);
    expect(b.getPersistedProjects()).toEqual(['Work']);
  });
});
