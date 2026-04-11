import { Module } from '@nestjs/common';
import { DependencyService } from './dependency.service';
import { GithubModule } from './github.module';
import { TaskwarriorModule } from './taskwarrior.module';
import { CalendarModule } from './calendar.module';
import { NotificationModule } from './notification.module';

@Module({
  imports: [GithubModule, TaskwarriorModule, CalendarModule, NotificationModule],
  providers: [DependencyService],
  exports: [DependencyService],
})
export class DependencyModule {}
