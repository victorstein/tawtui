import { Module } from '@nestjs/common';
import { ConfigModule } from './config.module';
import { GithubModule } from './github.module';
import { WorktreeModule } from './worktree.module';
import { PrDiffParser } from './pr-diff-parser.service';
import { AgentReviewService } from './agent-review.service';
import { HunkService } from './hunk.service';
import { HunkReviewRegistry } from './hunk-review-registry.service';

@Module({
  imports: [ConfigModule, GithubModule, WorktreeModule],
  providers: [
    PrDiffParser,
    AgentReviewService,
    HunkService,
    HunkReviewRegistry,
  ],
  exports: [PrDiffParser, AgentReviewService, HunkService, HunkReviewRegistry],
})
export class HunkReviewModule {}
