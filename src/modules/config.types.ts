export type { RepoConfig } from '../shared/types';

export interface UserPreferences {
  theme: string;
  archiveTime: string; // "midnight" or custom time
  defaultFilter: string; // default taskwarrior filter
}

export interface AppConfig {
  repos: import('../shared/types').RepoConfig[];
  preferences: UserPreferences;
}
