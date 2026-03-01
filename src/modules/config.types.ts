export type { RepoConfig } from '../shared/types';

export interface AgentDefinition {
  id: string; // 'claude-code', 'codex-cli', etc.
  label: string; // 'Claude Code'
  command: string; // 'claude'
  autoApproveFlag?: string; // '--dangerously-skip-permissions'
}

export interface CalendarConfig {
  defaultCalendarId: string;
  defaultTaskProject?: string;
  defaultTaskTags?: string[];
}

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  defaultCalendarId: 'primary',
};

export interface UserPreferences {
  theme: string;
  archiveTime: string; // "midnight" or custom time
  defaultFilter: string; // default taskwarrior filter
}

export interface ProjectAgentConfig {
  /** Taskwarrior project key — e.g. "org/repo-1" */
  projectKey: string;
  /** Agent type ID to use for PR reviews in this project (e.g. 'claude-code') */
  agentTypeId: string;
  /** Whether to auto-approve the agent (uses the agentType's autoApproveFlag) */
  autoApprove: boolean;
  /** Optional working directory override (defaults to process.cwd()) */
  cwd?: string;
  /** Files to copy from clone to worktree (e.g. [".env", ".env.local"]) */
  worktreeEnvFiles?: string[];
}

export interface AppConfig {
  repos: import('../shared/types').RepoConfig[];
  preferences: UserPreferences;
  agents?: { types: AgentDefinition[] };
  projectAgentConfigs?: ProjectAgentConfig[];
  calendar?: CalendarConfig;
}
