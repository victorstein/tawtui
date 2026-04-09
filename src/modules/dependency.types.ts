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
  /** slacktokens Python package is available for auto-extraction */
  slacktokensInstalled: boolean;
  /** pipx CLI is available for auto-install */
  pipxInstalled: boolean;
  /** Install instruction for mempalace */
  mempalaceInstallInstructions: string;
  /** Install instruction for slacktokens */
  slacktokensInstallInstructions: string;
  /** Install instruction for pipx itself (platform-aware) */
  pipxInstallInstructions: string;
}

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  slack: SlackDepStatus;
  oracleReady: boolean; // hasTokens && mempalaceInstalled
}
