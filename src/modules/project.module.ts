import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { TaskwarriorModule } from './taskwarrior.module';

@Module({
  imports: [TaskwarriorModule],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
