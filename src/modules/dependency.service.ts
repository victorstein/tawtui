import { Injectable } from '@nestjs/common';
import { GithubService } from './github.service';
import { TaskwarriorService } from './taskwarrior.service';
import type { DependencyStatus } from './dependency.types';

@Injectable()
export class DependencyService {
  constructor(
    private readonly githubService: GithubService,
    private readonly taskwarriorService: TaskwarriorService,
  ) {}

  async checkAll(): Promise<DependencyStatus> {
    const platform = process.platform;

    const [ghInstalled, ghAuthenticated, taskInstalled] = await Promise.all([
      this.githubService.isGhInstalled(),
      this.githubService.isAuthenticated(),
      this.taskwarriorService.isInstalled(),
    ]);

    return {
      gh: {
        installed: ghInstalled,
        instructions: this.getGhInstallInstructions(platform),
        authenticated: ghAuthenticated,
        authInstructions: 'gh auth login',
      },
      task: {
        installed: taskInstalled,
        instructions: this.getTaskInstallInstructions(platform),
      },
      platform,
      allGood: ghInstalled && ghAuthenticated && taskInstalled,
    };
  }

  private getGhInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install gh';
      case 'linux':
        return 'sudo apt install gh';
      default:
        return 'See https://cli.github.com for installation instructions';
    }
  }

  private getTaskInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install task';
      case 'linux':
        return 'sudo apt install taskwarrior';
      default:
        return 'See https://taskwarrior.org for installation instructions';
    }
  }
}
