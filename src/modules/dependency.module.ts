import { Module } from '@nestjs/common';
import { DependencyService } from './dependency.service';
import { GithubModule } from './github.module';
import { TaskwarriorModule } from './taskwarrior.module';
import { CalendarModule } from './calendar.module';
import { ConfigModule } from './config.module';
import { SlackModule } from './slack/slack.module';

@Module({
  imports: [
    GithubModule,
    TaskwarriorModule,
    CalendarModule,
    ConfigModule,
    SlackModule,
  ],
  providers: [DependencyService],
  exports: [DependencyService],
})
export class DependencyModule {}
