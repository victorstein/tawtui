jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

import { AgentReviewService } from '../../src/modules/agent-review.service';
import { PrDiffParser } from '../../src/modules/pr-diff-parser.service';

class KeyedFake extends AgentReviewService {
  public turns: { reviewId: string; prompt: string }[] = [];
  protected override runTurn(
    reviewId: string,
    prompt: string,
  ): Promise<{ sessionId: string; text: string }> {
    this.turns.push({ reviewId, prompt });
    // session id is a deterministic function of the reviewId so the test can prove isolation
    return Promise.resolve({ sessionId: `sess-${reviewId}`, text: 'answer' });
  }
}

describe('AgentReviewService - multi-session', () => {
  let svc: KeyedFake;
  beforeEach(() => {
    svc = new KeyedFake(new PrDiffParser());
  });

  describe('Behavior', () => {
    it('should keep an independent session id per reviewId', async () => {
      await svc.ask('o/r#pr-1-hunk', 'hi');
      await svc.ask('o/r#pr-2-hunk', 'hi');
      expect(svc.getSessionId('o/r#pr-1-hunk')).toBe('sess-o/r#pr-1-hunk');
      expect(svc.getSessionId('o/r#pr-2-hunk')).toBe('sess-o/r#pr-2-hunk');
    });

    it('should return undefined for an unknown reviewId', () => {
      expect(svc.getSessionId('nope')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should run two reviews concurrently without cross-contaminating prompts', async () => {
      await Promise.all([svc.ask('a', 'qa1'), svc.ask('b', 'qb1')]);
      const a = svc.turns
        .filter((t) => t.reviewId === 'a')
        .map((t) => t.prompt);
      const b = svc.turns
        .filter((t) => t.reviewId === 'b')
        .map((t) => t.prompt);
      expect(a).toEqual(['qa1']);
      expect(b).toEqual(['qb1']);
    });

    it('should dispose only the targeted review session', async () => {
      await svc.ask('a', 'q');
      await svc.ask('b', 'q');
      svc.dispose('a');
      expect(svc.getSessionId('a')).toBeUndefined();
      expect(svc.getSessionId('b')).toBe('sess-b');
    });
  });
});
