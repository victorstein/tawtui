import { Module } from '@nestjs/common';
import { DependencyService } from './dependency.service';
import { GithubModule } from './github.module';
import { TaskwarriorModule } from './taskwarrior.module';

@Module({
  imports: [GithubModule, TaskwarriorModule],
  providers: [DependencyService],
  exports: [DependencyService],
})
export class DependencyModule {}
