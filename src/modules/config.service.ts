import { Injectable, Logger } from '@nestjs/common';
import {
  mkdirSync,
  existsSync,
  renameSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  AgentDefinition,
  AppConfig,
  RepoConfig,
  UserPreferences,
} from './config.types';

const DEFAULT_CONFIG: AppConfig = {
  repos: [],
  preferences: {
    theme: 'default',
    archiveTime: 'midnight',
    defaultFilter: 'status:pending',
  },
};

const DEFAULT_AGENT_TYPES: AgentDefinition[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  { id: 'codex-cli', label: 'Codex CLI', command: 'codex' },
  { id: 'gemini-cli', label: 'Gemini CLI', command: 'gemini' },
  { id: 'cursor-agent', label: 'Cursor Agent', command: 'cursor-agent' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'pi-agent', label: 'Pi Agent', command: 'pi-agent' },
  { id: 'shell', label: 'Shell Only', command: '' },
];

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly configDir = join(homedir(), '.config', 'tawtui');
  private readonly configPath = join(this.configDir, 'config.json');
  private readonly tmpPath = join(this.configDir, 'config.json.tmp');
  private cachedConfig: AppConfig | null = null;

  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  load(): AppConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    this.ensureConfigDir();

    if (!existsSync(this.configPath)) {
      this.cachedConfig = structuredClone(DEFAULT_CONFIG);
      return this.cachedConfig;
    }

    try {
      const text = readFileSync(this.configPath, 'utf-8');
      const raw = JSON.parse(text);
      // Merge with defaults for forward compatibility
      const config: AppConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        ...raw,
        preferences: { ...DEFAULT_CONFIG.preferences, ...raw.preferences },
      };
      this.cachedConfig = config;
      return config;
    } catch (err) {
      this.logger.warn(`Failed to load config, using defaults: ${err}`);
      this.cachedConfig = structuredClone(DEFAULT_CONFIG);
      return this.cachedConfig;
    }
  }

  save(config: AppConfig): void {
    this.ensureConfigDir();

    const json = JSON.stringify(config, null, 2);
    writeFileSync(this.tmpPath, json, 'utf-8');
    renameSync(this.tmpPath, this.configPath);

    this.cachedConfig = config;
  }

  getRepos(): RepoConfig[] {
    const config = this.load();
    return config.repos;
  }

  addRepo(repo: RepoConfig): void {
    const config = this.load();
    const duplicate = config.repos.some(
      (r) => r.owner === repo.owner && r.repo === repo.repo,
    );

    if (!duplicate) {
      config.repos = [...config.repos, repo];
      this.save(config);
    }
  }

  removeRepo(owner: string, repo: string): void {
    const config = this.load();
    config.repos = config.repos.filter(
      (r) => !(r.owner === owner && r.repo === repo),
    );
    this.save(config);
  }

  getPreferences(): UserPreferences {
    const config = this.load();
    return config.preferences;
  }

  updatePreferences(prefs: Partial<UserPreferences>): void {
    const config = this.load();
    config.preferences = { ...config.preferences, ...prefs };
    this.save(config);
  }

  getAgentTypes(): AgentDefinition[] {
    const config = this.load();
    return config.agents?.types ?? DEFAULT_AGENT_TYPES;
  }
}
