jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { writeFileSync } from 'fs';
import { TuiService } from '../../src/modules/tui.service';
import type { HunkReviewRecord } from '../../src/modules/hunk-review.types';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  writeFileSync: jest.fn(),
}));

function makeSvc(over: Record<string, unknown>): TuiService {
  const svc = Object.create(TuiService.prototype) as TuiService;
  Object.assign(svc, over);
  return svc;
}

describe('TuiService.startHunkReview - dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function recWith(status: HunkReviewRecord['status']): HunkReviewRecord {
    return {
      prKey: 'o/r#pr-7-hunk',
      repoOwner: 'o',
      repoName: 'r',
      prNumber: 7,
      worktreePath: '/wt',
      port: 0,
      status,
      createdAt: 'x',
      chat: [],
    };
  }

  it.each(['ready', 'open', 'reviewing', 'creating'] as const)(
    'should return an existing-review marker without creating a new one when status is %s',
    async (status) => {
      const registry = {
        get: jest.fn().mockReturnValue(recWith(status)),
        add: jest.fn(),
      };
      const worktree = { createWorktree: jest.fn() };
      const svc = makeSvc({
        hunkReviewRegistry: registry,
        worktreeService: worktree,
      });
      const result = await svc.startHunkReview('o', 'r', 7, 'PR');
      expect(result).toEqual({ prKey: 'o/r#pr-7-hunk', existing: true });
      expect(worktree.createWorktree).not.toHaveBeenCalled();
      expect(registry.add).not.toHaveBeenCalled();
    },
  );

  it.each(['interrupted', 'error'] as const)(
    'should re-create (replace) a %s review rather than dedup to it',
    async (status) => {
      const registry = {
        get: jest.fn().mockReturnValue(recWith(status)),
        add: jest.fn(),
        update: jest.fn(),
        appendChat: jest.fn(),
      };
      const worktree = {
        createWorktree: jest
          .fn()
          .mockResolvedValue({ id: 'o/r#pr-7-hunk', path: '/wt' }),
      };
      const github = {
        getPrDiff: jest
          .fn()
          .mockResolvedValue({ raw: '', prNumber: 7, repoFullName: 'o/r' }),
      };
      const parser = {
        parse: jest.fn().mockReturnValue({ files: [] }),
        isOverThreshold: jest.fn().mockReturnValue(true),
      };
      const agentReview = {
        getSessionId: jest.fn().mockReturnValue(undefined),
      };
      const config = {
        getHunkConfig: jest.fn().mockReturnValue({
          agentAuthorLabel: 'tawtui-review',
          maxDiffBytes: 9_000_000,
        }),
        configDirPublic: jest.fn().mockReturnValue('/cfg'),
      };
      const svc = makeSvc({
        hunkReviewRegistry: registry,
        worktreeService: worktree,
        githubService: github,
        prDiffParser: parser,
        agentReviewService: agentReview,
        configService: config,
      });
      const result = await svc.startHunkReview('o', 'r', 7, 'PR');
      expect(result).toEqual({ prKey: 'o/r#pr-7-hunk', existing: false });
      expect(worktree.createWorktree).toHaveBeenCalled();
      expect(registry.add).toHaveBeenCalled();
      await svc.awaitBackgroundForTest('o/r#pr-7-hunk'); // non-optional (I2)
    },
  );
});

describe('TuiService.startHunkReview - background run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create the review, run in the background, and update the registry to ready', async () => {
    const updates: Record<string, unknown>[] = [];
    const registry = {
      get: jest.fn().mockReturnValue(undefined),
      add: jest.fn(),
      update: jest.fn((_k: string, patch: Record<string, unknown>) =>
        updates.push(patch),
      ),
      appendChat: jest.fn(),
    };
    const worktree = {
      createWorktree: jest
        .fn()
        .mockResolvedValue({ id: 'o/r#pr-7-hunk', path: '/wt' }),
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
        agentContextPath: '/cfg/f.json',
      }),
      getSessionId: jest.fn().mockReturnValue('sess-1'),
    };
    const config = {
      getHunkConfig: jest.fn().mockReturnValue({
        agentAuthorLabel: 'tawtui-review',
        maxDiffBytes: 9_000_000,
      }),
      configDirPublic: jest.fn().mockReturnValue('/cfg'),
    };
    const svc = makeSvc({
      hunkReviewRegistry: registry,
      worktreeService: worktree,
      githubService: github,
      prDiffParser: parser,
      agentReviewService: agentReview,
      configService: config,
    });

    const marker = await svc.startHunkReview('o', 'r', 7, 'PR');
    expect(marker).toEqual({ prKey: 'o/r#pr-7-hunk', existing: false });
    expect(registry.add).toHaveBeenCalled();

    // background work resolves on the next microtasks. Call the seam NON-OPTIONALLY
    // (I2): if the method is missing this throws loudly instead of silently passing.
    await svc.awaitBackgroundForTest('o/r#pr-7-hunk');
    expect(agentReview.startReview).toHaveBeenCalledWith(
      'o/r#pr-7-hunk',
      expect.anything(),
    );
    const ready = updates.find((u) => u.status === 'ready');
    expect(ready).toMatchObject({ status: 'ready', sdkSessionId: 'sess-1' });
    expect((ready?.body as { summary: string }).summary).toBe('s');
  });
});

describe('TuiService.askHunkChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should route to the keyed ask and append both turns', async () => {
    const agentReview = { ask: jest.fn().mockResolvedValue('reply') };
    const registry = { appendChat: jest.fn() };
    const svc = makeSvc({
      agentReviewService: agentReview,
      hunkReviewRegistry: registry,
    });
    const reply = await svc.askHunkChat('o/r#pr-7-hunk', 'q');
    expect(reply).toBe('reply');
    expect(agentReview.ask).toHaveBeenCalledWith('o/r#pr-7-hunk', 'q');
    expect(registry.appendChat).toHaveBeenNthCalledWith(1, 'o/r#pr-7-hunk', {
      role: 'user',
      text: 'q',
    });
    expect(registry.appendChat).toHaveBeenNthCalledWith(2, 'o/r#pr-7-hunk', {
      role: 'agent',
      text: 'reply',
    });
  });
});

describe('TuiService.killHunkReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should dispose the keyed session, remove the worktree, and remove the record', async () => {
    const agentReview = { dispose: jest.fn() };
    const worktree = { removeWorktree: jest.fn().mockResolvedValue(undefined) };
    const registry = {
      get: jest.fn().mockReturnValue({ prKey: 'o/r#pr-7-hunk' }),
      remove: jest.fn(),
    };
    const svc = makeSvc({
      agentReviewService: agentReview,
      worktreeService: worktree,
      hunkReviewRegistry: registry,
    });
    await svc.killHunkReview('o/r#pr-7-hunk');
    expect(agentReview.dispose).toHaveBeenCalledWith('o/r#pr-7-hunk');
    expect(worktree.removeWorktree).toHaveBeenCalledWith('o/r#pr-7-hunk');
    expect(registry.remove).toHaveBeenCalledWith('o/r#pr-7-hunk');
  });
});

// Retain writeFileSync import usage check (it is referenced in background-run test above
// via the jest.mock('fs', ...) that stubs it; this avoids an unused-import lint warning).
void writeFileSync;
