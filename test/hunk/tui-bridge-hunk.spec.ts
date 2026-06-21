jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { writeFileSync } from 'fs';
import { TuiService } from '../../src/modules/tui.service';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  writeFileSync: jest.fn(),
}));

describe('TuiService.startHunkReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should orchestrate worktree → diff → review → registry', async () => {
    const worktree = {
      createWorktree: jest.fn().mockResolvedValue({
        id: 'o/r#pr-7-hunk',
        path: '/wt',
        namespace: 'hunk',
      }),
    };
    const github = {
      getPrDiff: jest.fn().mockResolvedValue({
        raw: 'diff --git a/x b/x\n@@ -1 +1 @@\n a\n',
        prNumber: 7,
        repoFullName: 'o/r',
      }),
    };
    const parser = {
      parse: jest.fn().mockReturnValue({ files: [] }),
      isOverThreshold: jest.fn().mockReturnValue(false),
    };
    const agentReview = {
      startReview: jest.fn().mockResolvedValue({
        body: { summary: 's', unanchoredFindings: [], unanchoredCount: 0 },
        anchoredFindings: [],
        agentContextPath: '/cfg/findings.json',
      }),
      getSessionId: jest.fn().mockReturnValue('sess-1'),
    };
    const registry = { add: jest.fn(), update: jest.fn() };
    const config = {
      getHunkConfig: jest.fn().mockReturnValue({
        agentAuthorLabel: 'tawtui-review',
        maxDiffBytes: 9_000_000,
      }),
      configDirPublic: jest.fn().mockReturnValue('/cfg'),
    };

    const svc = Object.create(TuiService.prototype) as TuiService;
    Object.assign(svc, {
      worktreeService: worktree,
      githubService: github,
      prDiffParser: parser,
      agentReviewService: agentReview,
      hunkReviewRegistry: registry,
      configService: config,
    });

    const result = await svc.startHunkReview('o', 'r', 7, 'PR title');
    expect(worktree.createWorktree).toHaveBeenCalledWith(
      'o',
      'r',
      7,
      undefined,
      'hunk',
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      '/wt/pr.diff',
      expect.any(String),
      'utf-8',
    );
    expect(agentReview.startReview).toHaveBeenCalled();
    expect(registry.add).toHaveBeenCalled();
    expect(result.body.summary).toBe('s');
    expect(result.prKey).toBe('o/r#pr-7-hunk');
  });
});
