import { HunkReviewRegistry } from '../../src/modules/hunk-review-registry.service';
import { mkdtempSync, rmSync } from 'fs';
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
});
