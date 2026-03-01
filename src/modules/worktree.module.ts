import { Module } from '@nestjs/common';
import { WorktreeService } from './worktree.service';

@Module({
  providers: [WorktreeService],
  exports: [WorktreeService],
})
export class WorktreeModule {}
