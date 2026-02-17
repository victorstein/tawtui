export type { RepoConfig } from '../shared/types';

export interface AgentDefinition {
  id: string; // 'claude-code', 'codex-cli', etc.
  label: string; // 'Claude Code'
  command: string; // 'claude'
  autoApproveFlag?: string; // '--dangerously-skip-permissions'
}

export interface UserPreferences {
  theme: string;
  archiveTime: string; // "midnight" or custom time
  defaultFilter: string; // default taskwarrior filter
}

export interface AppConfig {
  repos: import('../shared/types').RepoConfig[];
  preferences: UserPreferences;
  agents?: { types: AgentDefinition[] };
}
