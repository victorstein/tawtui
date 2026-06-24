import { HunkReviewRegistry } from '../../src/modules/hunk-review-registry.service';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { HunkReviewRecord } from '../../src/modules/hunk-review.types';

function freshRegistry(dir: string): HunkReviewRegistry {
  const r = new HunkReviewRegistry();
  (r as unknown as { storePath: string }).storePath = join(
    dir,
    'hunk-reviews.json',
  );
  (r as unknown as { reviews: Map<string, HunkReviewRecord> }).reviews =
    new Map();
  return r;
}

const REC: HunkReviewRecord = {
  prKey: 'octo/repo#pr-7',
  repoOwner: 'octo',
  repoName: 'repo',
  prNumber: 7,
  worktreePath: '/wt',
  port: 41001,
  status: 'reviewing',
  createdAt: '2026-06-20T00:00:00.000Z',
  chat: [],
};

describe('HunkReviewRegistry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tawtui-hunkreg-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('should add a review and surface it by key and in the list', () => {
    const reg = freshRegistry(dir);
    reg.add(REC);
    expect(reg.get('octo/repo#pr-7')?.port).toBe(41001);
    expect(reg.list()).toHaveLength(1);
  });

  it('should update status and session id in place', () => {
    const reg = freshRegistry(dir);
    reg.add(REC);
    reg.update('octo/repo#pr-7', { status: 'ready', sdkSessionId: 'sess-1' });
    expect(reg.get('octo/repo#pr-7')?.status).toBe('ready');
    expect(reg.get('octo/repo#pr-7')?.sdkSessionId).toBe('sess-1');
  });

  it('should remove a review', () => {
    const reg = freshRegistry(dir);
    reg.add(REC);
    reg.remove('octo/repo#pr-7');
    expect(reg.get('octo/repo#pr-7')).toBeUndefined();
  });

  it('should rediscover persisted reviews from disk on a fresh instance', () => {
    freshRegistry(dir).add(REC);
    const reloaded = freshRegistry(dir);
    reloaded.rediscover();
    expect(reloaded.get('octo/repo#pr-7')?.prNumber).toBe(7);
  });

  describe('appendChat', () => {
    describe('Behavior', () => {
      it('should append a chat message and persist it', () => {
        const reg = freshRegistry(dir);
        reg.add({ ...REC, chat: [] });
        reg.appendChat('octo/repo#pr-7', { role: 'user', text: 'hello' });
        reg.appendChat('octo/repo#pr-7', { role: 'agent', text: 'hi' });
        expect(reg.get('octo/repo#pr-7')?.chat).toEqual([
          { role: 'user', text: 'hello' },
          { role: 'agent', text: 'hi' },
        ]);
        // round-trips from disk
        const reloaded = freshRegistry(dir);
        reloaded.rediscover();
        expect(reloaded.get('octo/repo#pr-7')?.chat).toHaveLength(2);
      });

      it('should no-op when the review does not exist', () => {
        const reg = freshRegistry(dir);
        expect(() =>
          reg.appendChat('missing', { role: 'user', text: 'x' }),
        ).not.toThrow();
      });
    });
  });

  describe('rediscover', () => {
    describe('stale-marking', () => {
      it('should mark creating/reviewing records interrupted on reload', () => {
        const seed = freshRegistry(dir);
        seed.add({ ...REC, prKey: 'a', status: 'reviewing', chat: [] });
        seed.add({ ...REC, prKey: 'b', status: 'creating', chat: [] });
        seed.add({ ...REC, prKey: 'c', status: 'ready', chat: [] });
        const reloaded = freshRegistry(dir);
        reloaded.rediscover();
        expect(reloaded.get('a')?.status).toBe('interrupted');
        expect(reloaded.get('b')?.status).toBe('interrupted');
        expect(reloaded.get('c')?.status).toBe('ready');
      });
    });

    describe('legacy backfill', () => {
      it('should backfill chat to [] for a record persisted before the chat field existed', () => {
        const legacy = {
          prKey: 'octo/repo#pr-7',
          repoOwner: 'octo',
          repoName: 'repo',
          prNumber: 7,
          worktreePath: '/wt',
          port: 0,
          status: 'ready',
          createdAt: 'x',
        };
        writeFileSync(
          join(dir, 'hunk-reviews.json'),
          JSON.stringify([legacy]),
          'utf-8',
        );

        const reg = freshRegistry(dir);
        reg.rediscover();
        const r = reg.get('octo/repo#pr-7');
        expect(r?.chat).toEqual([]); // backfilled, NOT undefined
        expect(() =>
          reg.appendChat('octo/repo#pr-7', { role: 'user', text: 'hi' }),
        ).not.toThrow();
        expect(reg.get('octo/repo#pr-7')?.chat).toEqual([
          { role: 'user', text: 'hi' },
        ]);
      });
    });
  });

  describe('round-trip', () => {
    describe('body/paths', () => {
      it('should persist and reload body, agentContextPath, patchPath', () => {
        const seed = freshRegistry(dir);
        seed.add({
          ...REC,
          chat: [],
          body: { summary: 's', unanchoredFindings: [], unanchoredCount: 0 },
          agentContextPath: '/cfg/findings.json',
          patchPath: '/wt/pr.diff',
        });
        const reloaded = freshRegistry(dir);
        reloaded.rediscover();
        const r = reloaded.get('octo/repo#pr-7');
        expect(r?.body?.summary).toBe('s');
        expect(r?.agentContextPath).toBe('/cfg/findings.json');
        expect(r?.patchPath).toBe('/wt/pr.diff');
      });
    });
  });
});
