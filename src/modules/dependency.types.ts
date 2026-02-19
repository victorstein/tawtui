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

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
}
