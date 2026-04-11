export interface DepStatus {
  installed: boolean;
  instructions: string;
}

export interface GhDepStatus extends DepStatus {
  authenticated: boolean;
  authInstructions: string;
}

export interface GogDepStatus extends DepStatus {
  authenticated: boolean;
  authInstructions: string;
  hasCredentials: boolean;
  credentialsPath: string;
}

export interface SlackDepStatus {
  /** xoxc + xoxd tokens exist in config */
  hasTokens: boolean;
  /** mempalace CLI is available */
  mempalaceInstalled: boolean;
  /** Slack desktop app is installed locally (tokens can be auto-detected) */
  slackAppDetected: boolean;
  /** pipx CLI is available for auto-install */
  pipxInstalled: boolean;
  /** Install instruction for mempalace */
  mempalaceInstallInstructions: string;
  /** Install instruction for pipx itself (platform-aware) */
  pipxInstallInstructions: string;
}

export type NotificationDepStatus = DepStatus;

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  notification: NotificationDepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  slack: SlackDepStatus;
  oracleInitialized: boolean;
  oracleReady: boolean; // hasTokens && mempalaceInstalled && oracleInitialized
  notificationsReady: boolean;
}
