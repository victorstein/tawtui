export interface DepStatus {
  installed: boolean;
  instructions: string;
}

export interface GhDepStatus extends DepStatus {
  authenticated: boolean;
  authInstructions: string;
}

export interface DependencyStatus {
  gh: GhDepStatus;
  task: DepStatus;
  platform: NodeJS.Platform;
  allGood: boolean;
}
