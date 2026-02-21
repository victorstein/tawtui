import { Injectable } from '@nestjs/common';
import { GithubService } from './github.service';
import { TaskwarriorService } from './taskwarrior.service';
import { CalendarService } from './calendar.service';
import type { DependencyStatus } from './dependency.types';

@Injectable()
export class DependencyService {
  constructor(
    private readonly githubService: GithubService,
    private readonly taskwarriorService: TaskwarriorService,
    private readonly calendarService: CalendarService,
  ) {}

  async checkAll(): Promise<DependencyStatus> {
    const platform = process.platform;

    const [
      ghInstalled,
      ghAuthenticated,
      taskInstalled,
      gogInstalled,
      gogAuthenticated,
      gogCredentials,
    ] = await Promise.all([
      this.githubService.isGhInstalled(),
      this.githubService.isAuthenticated(),
      this.taskwarriorService.isInstalled(),
      this.calendarService.isInstalled(),
      this.calendarService.isAuthenticated(),
      this.calendarService.hasCredentials(),
    ]);

    return {
      gh: {
        installed: ghInstalled,
        instructions: this.getGhInstallInstructions(platform),
        authenticated: ghAuthenticated,
        authInstructions: 'gh auth login',
      },
      gog: {
        installed: gogInstalled,
        instructions: this.getGogInstallInstructions(platform),
        authenticated: gogAuthenticated,
        authInstructions: 'gog auth add you@gmail.com',
        credentialsConfigured: gogCredentials,
      },
      task: {
        installed: taskInstalled,
        instructions: this.getTaskInstallInstructions(platform),
      },
      platform,
      allGood:
        ghInstalled &&
        ghAuthenticated &&
        taskInstalled &&
        gogInstalled &&
        gogAuthenticated,
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

  private getGogInstallInstructions(platform: NodeJS.Platform): string {
    switch (platform) {
      case 'darwin':
        return 'brew install steipete/tap/gogcli';
      case 'linux':
        return 'brew install steipete/tap/gogcli';
      default:
        return 'See https://github.com/steipete/gogcli for installation instructions';
    }
  }
}
