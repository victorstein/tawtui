import { Injectable } from '@nestjs/common';
import { GithubService } from './github.service';
import { TaskwarriorService } from './taskwarrior.service';
import { CalendarService } from './calendar.service';
import { ConfigService } from './config.service';
import type { DependencyStatus, SlackDepStatus } from './dependency.types';

@Injectable()
export class DependencyService {
  constructor(
    private readonly githubService: GithubService,
    private readonly taskwarriorService: TaskwarriorService,
    private readonly calendarService: CalendarService,
    private readonly configService: ConfigService,
  ) {}

  async checkAll(): Promise<DependencyStatus> {
    const platform = process.platform;

    const taskInstalled = this.taskwarriorService.isInstalled();

    const slackStatus = this.checkSlack();

    const [
      ghInstalled,
      ghAuthenticated,
      gogInstalled,
      gogAuthenticated,
      gogHasCredentials,
    ] = await Promise.all([
      this.githubService.isGhInstalled(),
      this.githubService.isAuthenticated(),
      this.calendarService.isInstalled(),
      this.calendarService.isAuthenticated(),
      this.calendarService.hasCredentials(),
    ]);

    const gogCredentialsPath = this.calendarService.getCredentialsPath();

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
        hasCredentials: gogHasCredentials,
        credentialsPath: gogCredentialsPath,
      },
      task: {
        installed: taskInstalled,
        instructions: this.getTaskInstallInstructions(platform),
      },
      platform,
      allGood: ghInstalled && ghAuthenticated && taskInstalled,
      calendarReady: gogInstalled && gogAuthenticated && gogHasCredentials,
      slack: slackStatus,
      oracleReady: slackStatus.hasTokens && slackStatus.mempalaceInstalled,
    };
  }

  private checkSlack(): SlackDepStatus {
    const oracleConfig = this.configService.getOracleConfig();
    const hasTokens =
      !!oracleConfig.slack?.xoxcToken && !!oracleConfig.slack?.xoxdCookie;

    const mempalaceInstalled = this.isPythonPackageAvailable(
      'mempalace',
      'status',
    );
    const slacktokensInstalled = this.isPythonPackageAvailable('slacktokens');

    return {
      hasTokens,
      mempalaceInstalled,
      slacktokensInstalled,
      mempalaceInstallInstructions: 'pip install mempalace',
      slacktokensInstallInstructions: 'pip install slacktokens',
    };
  }

  private isPythonPackageAvailable(
    pkg: string,
    subcommand = '--version',
  ): boolean {
    const result = Bun.spawnSync(['python3', '-m', pkg, subcommand], {
      stderr: 'pipe',
      stdout: 'pipe',
    });
    return result.exitCode === 0;
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
        return 'go install github.com/steipete/gogcli@latest';
      default:
        return 'See https://github.com/steipete/gogcli for installation instructions';
    }
  }
}
