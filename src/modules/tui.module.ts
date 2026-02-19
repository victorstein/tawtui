import { Module } from '@nestjs/common';
import { TuiService } from './tui.service';
import { TaskwarriorModule } from './taskwarrior.module';
import { GithubModule } from './github.module';
import { TerminalModule } from './terminal.module';
import { DependencyModule } from './dependency.module';
import { CalendarModule } from './calendar.module';

@Module({
  imports: [
    TaskwarriorModule,
    GithubModule,
    TerminalModule,
    DependencyModule,
    CalendarModule,
  ],
  providers: [TuiService],
  exports: [TuiService],
})
export class TuiModule {}
