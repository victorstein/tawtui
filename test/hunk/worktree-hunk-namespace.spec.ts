import { WorktreeTestHelper } from '../helpers/worktree-test.helper';
const originalBun = globalThis.Bun;

describe('WorktreeService - hunk namespace', () => {
  afterEach(() => {
    (globalThis as Record<string, unknown>).Bun = originalBun;
  });

  it('should create a pr-{n}-hunk worktree with a distinct id and path', async () => {
    (globalThis as Record<string, unknown>).Bun = {
      spawn: WorktreeTestHelper.routedSpawn({
        'fetch origin': { exitCode: 0 },
        'worktree add': { exitCode: 0 },
      }),
    };
    const stack = WorktreeTestHelper.createStack();
    // Seed a managed clone so ensureClone short-circuits.
    (stack.service as unknown as { repos: Map<string, unknown> }).repos.set(
      'octo/repo',
      {
        owner: 'octo',
        repo: 'repo',
        clonePath: stack.baseDir,
        clonedAt: new Date(),
        lastFetchedAt: new Date(),
      },
    );

    const info = await stack.service.createWorktree(
      'octo',
      'repo',
      7,
      undefined,
      'hunk',
    );
    expect(info.id).toBe('octo/repo#pr-7-hunk');
    expect(info.branch).toBe('tawtui/pr-7-hunk');
    expect(info.path).toContain('pr-7-hunk');
    expect(info.namespace).toBe('hunk');

    expect(stack.service.findByPr('octo', 'repo', 7, 'hunk')?.id).toBe(
      'octo/repo#pr-7-hunk',
    );
    expect(stack.service.findByPr('octo', 'repo', 7)).toBeUndefined();
    stack.cleanup();
  });
});
