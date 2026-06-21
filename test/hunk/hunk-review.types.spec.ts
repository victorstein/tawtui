import type {
  DiffLineMap,
  AgentContext,
  ReviewOutput,
  HunkReviewRecord,
} from '../../src/modules/hunk-review.types';

describe('hunk-review.types', () => {
  it('should model a diff line-map keyed by file path', () => {
    const map: DiffLineMap = {
      files: [
        {
          path: 'src/a.ts',
          newLines: new Set([10, 11, 12]),
          changeKind: 'modified',
          binary: false,
        },
      ],
    };
    expect(map.files[0].newLines.has(11)).toBe(true);
  });

  it('should model the hunk agent-context schema', () => {
    const ctx: AgentContext = {
      version: 1,
      summary: 'overview',
      files: [
        {
          path: 'src/a.ts',
          annotations: [
            { newRange: [10, 12], summary: 'note', author: 'tawtui-review' },
          ],
        },
      ],
    };
    expect(ctx.files[0].annotations[0].newRange).toEqual([10, 12]);
  });

  it('should model the persisted hunk-review record', () => {
    const rec: HunkReviewRecord = {
      prKey: 'octo/repo#pr-7',
      repoOwner: 'octo',
      repoName: 'repo',
      prNumber: 7,
      worktreePath: '/tmp/wt',
      port: 41001,
      sdkSessionId: 'abc-123',
      status: 'ready',
      createdAt: new Date().toISOString(),
    };
    const out: ReviewOutput = {
      body: { summary: 's', unanchoredFindings: [], unanchoredCount: 0 },
      anchoredFindings: [],
      agentContextPath: '/tmp/findings.json',
    };
    expect(rec.status).toBe('ready');
    expect(out.body.unanchoredCount).toBe(0);
  });
});
