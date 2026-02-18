import { Injectable } from '@nestjs/common';
import { render } from '@opentui/solid';
import { App } from './tui/app';
import { TaskwarriorService } from './taskwarrior.service';
import { GithubService } from './github.service';
import { ConfigService } from './config.service';
import { TerminalService } from './terminal.service';
import { DependencyService } from './dependency.service';
import { CalendarService } from './calendar.service';

@Injectable()
export class TuiService {
  constructor(
    private readonly taskwarriorService: TaskwarriorService,
    private readonly githubService: GithubService,
    private readonly configService: ConfigService,
    private readonly terminalService: TerminalService,
    private readonly dependencyService: DependencyService,
    private readonly calendarService: CalendarService,
  ) {}

  async launch(): Promise<void> {
    // Bridge NestJS services to SolidJS components via globalThis.
    // SolidJS components don't have access to the NestJS DI container,
    // so we expose required services on a well-known global.
    (globalThis as any).__tawtui = {
      taskwarriorService: this.taskwarriorService,
      githubService: this.githubService,
      configService: this.configService,
      terminalService: this.terminalService,
      dependencyService: this.dependencyService,
      calendarService: this.calendarService,
      createPrReviewSession: (
        prNumber: number,
        repoOwner: string,
        repoName: string,
        prTitle: string,
      ) =>
        this.terminalService.createPrReviewSession(
          prNumber,
          repoOwner,
          repoName,
          prTitle,
        ),
    };

    // Set up the exit promise before rendering so the App component
    // can resolve it at any time (even during the initial render pass).
    const exitPromise = new Promise<void>((resolve) => {
      (globalThis as any).__tuiExit = resolve;
    });

    // render() accepts either a CliRenderer or a CliRendererConfig.
    // When given a config object it creates the renderer internally,
    // wraps the component in a RendererContext.Provider, and enters
    // the alternate screen buffer automatically.
    await render(App, {
      useAlternateScreen: true,
      useMouse: true,
    });

    // Keep the process alive until the user presses 'q'.
    // The App component calls (globalThis as any).__tuiExit() on quit.
    await exitPromise;
  }
}
