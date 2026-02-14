import { Module } from '@nestjs/common';
import { TaskwarriorService } from './taskwarrior.service';

@Module({
  providers: [TaskwarriorService],
  exports: [TaskwarriorService],
})
export class TaskwarriorModule {}
