jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { HunkReviewModule } from '../../src/modules/hunk-review.module';
import { PrDiffParser } from '../../src/modules/pr-diff-parser.service';
import { AgentReviewService } from '../../src/modules/agent-review.service';
import { HunkService } from '../../src/modules/hunk.service';
import { HunkReviewRegistry } from '../../src/modules/hunk-review-registry.service';

describe('HunkReviewModule', () => {
  it('should resolve all hunk providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HunkReviewModule],
    }).compile();
    expect(moduleRef.get(PrDiffParser)).toBeInstanceOf(PrDiffParser);
    expect(moduleRef.get(AgentReviewService)).toBeInstanceOf(
      AgentReviewService,
    );
    expect(moduleRef.get(HunkService)).toBeInstanceOf(HunkService);
    expect(moduleRef.get(HunkReviewRegistry)).toBeInstanceOf(
      HunkReviewRegistry,
    );
    await moduleRef.close();
  });
});
