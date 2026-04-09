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

export interface SlackCredentials {
  /** xoxc- session token extracted from Slack browser/desktop */
  xoxcToken: string;
  /** xoxd- cookie value extracted from Slack browser/desktop */
  xoxdCookie: string;
  /** Slack workspace/team ID (e.g. "T012AB3CD") */
  teamId: string;
  /** Slack workspace name for display */
  teamName: string;
}

export interface OracleConfig {
  /** Slack session credentials — set via setup wizard */
  slack?: SlackCredentials;
  /** How often the daemon polls Slack in seconds (default: 300 = 5 min) */
  pollIntervalSeconds: number;
  /** Taskwarrior project to assign Oracle-created tasks */
  defaultProject?: string;
}

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  pollIntervalSeconds: 300,
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
  oracle?: OracleConfig;
}
