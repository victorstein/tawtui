jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import {
  AgentReviewService,
  AgentReviewError,
} from '../../src/modules/agent-review.service';
import type { StartReviewContext } from '../../src/modules/agent-review.service';
import { PrDiffParser } from '../../src/modules/pr-diff-parser.service';
import type { AgentContext } from '../../src/modules/hunk-review.types';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SIMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' a',
  '+b',
  '',
].join('\n'); // newLines {1,2}

describe('AgentReviewService - buildReviewOutput', () => {
  let svc: AgentReviewService;
  let parser: PrDiffParser;
  let dir: string;
  beforeEach(() => {
    parser = new PrDiffParser();
    svc = new AgentReviewService(parser);
    dir = mkdtempSync(join(tmpdir(), 'tawtui-agentrev-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('should write anchored findings to findings.json and route the rest to the body', () => {
    const map = parser.parse(SIMPLE);
    const raw = JSON.stringify({
      summary: 'looks ok',
      findings: [
        {
          file: 'src/a.ts',
          line: 2,
          severity: 'warning',
          summary: 'anchored',
          rationale: 'why',
        },
        { file: 'src/a.ts', line: 99, severity: 'info', summary: 'off-diff' },
      ],
    });
    const ctxPath = join(dir, 'findings.json');
    const out = svc.buildReviewOutput(raw, map, ctxPath, 'tawtui-review');

    expect(out.anchoredFindings).toHaveLength(1);
    expect(out.body.unanchoredCount).toBe(1);
    expect(out.body.summary).toBe('looks ok');

    const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8')) as AgentContext;
    expect(ctx.version).toBe(1);
    expect(ctx.files[0].path).toBe('src/a.ts');
    expect(ctx.files[0].annotations[0].newRange).toEqual([2, 2]);
    expect(ctx.files[0].annotations[0].author).toBe('tawtui-review');
  });

  it('should throw AgentReviewError on non-JSON model output', () => {
    const map = parser.parse(SIMPLE);
    expect(() =>
      svc.buildReviewOutput(
        'not json',
        map,
        join(dir, 'f.json'),
        'tawtui-review',
      ),
    ).toThrow(AgentReviewError);
  });
});

describe('AgentReviewService - startReview / ask', () => {
  class FakeAgentReviewService extends AgentReviewService {
    public calls: { reviewId: string; prompt: string }[] = [];
    public reply = '';
    protected override runTurn(
      reviewId: string,
      prompt: string,
    ): Promise<{ sessionId: string; text: string }> {
      this.calls.push({ reviewId, prompt });
      return Promise.resolve({ sessionId: 'sess-1', text: this.reply });
    }
  }

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tawtui-agentrev-sdk-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('should run one review turn and store the session under the reviewId', async () => {
    const parser = new PrDiffParser();
    const svc = new FakeAgentReviewService(parser);
    svc.reply = JSON.stringify({ summary: 'ok', findings: [] });
    const map = parser.parse(SIMPLE);
    const ctx: StartReviewContext = {
      diffRaw: SIMPLE,
      lineMap: map,
      agentContextPath: join(dir, 'f.json'),
      authorLabel: 'tawtui-review',
      prTitle: 'PR',
    };
    const out = await svc.startReview('o/r#pr-7-hunk', ctx);
    expect(out.body.summary).toBe('ok');
    expect(svc.getSessionId('o/r#pr-7-hunk')).toBe('sess-1');
  });

  it('should serialize ask() turns FIFO within a single review', async () => {
    const parser = new PrDiffParser();
    const svc = new FakeAgentReviewService(parser);
    svc.reply = 'answer';
    const id = 'o/r#pr-7-hunk';
    const [a, b] = await Promise.all([svc.ask(id, 'q1'), svc.ask(id, 'q2')]);
    expect(a).toBe('answer');
    expect(b).toBe('answer');
    expect(svc.calls.map((c) => c.prompt)).toEqual(['q1', 'q2']);
  });
});
