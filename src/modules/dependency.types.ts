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

export type NotificationDepStatus = DepStatus;

export interface DependencyStatus {
  gh: GhDepStatus;
  gog: GogDepStatus;
  task: DepStatus;
  notification: NotificationDepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
  calendarReady: boolean;
  notificationsReady: boolean;
}
