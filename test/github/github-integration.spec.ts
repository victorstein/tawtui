/* eslint-disable @typescript-eslint/no-unsafe-return */

import { TerminalTestHelper } from '../helpers/terminal-test.helper';

// Save original Bun global
const originalBun = globalThis.Bun;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRoutedSpawn(
  routes: Record<
    string,
    { stdout?: string; stderr?: string; exitCode?: number }
  >,
): jest.Mock {
  return jest.fn((cmd: string[]) => {
    const joined = cmd.join(' ');
    for (const [pattern, result] of Object.entries(routes)) {
      if (joined.includes(pattern)) {
        return TerminalTestHelper.mockSpawn(
          result.stdout ?? '',
          result.stderr ?? '',
          result.exitCode ?? 0,
        )();
      }
    }
    return TerminalTestHelper.mockSpawn('', '', 0)();
  });
}

function setBunSpawn(spawnFn: jest.Mock) {
  (globalThis as Record<string, unknown>).Bun = { spawn: spawnFn };
}

// ---------------------------------------------------------------------------
// Import service (after Bun global is available)
// ---------------------------------------------------------------------------

import { GithubService } from '../../src/modules/github.service';

describe('GithubService Integration', () => {
  let service: GithubService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GithubService();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Bun = originalBun;
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // GH-BC-1: Truncated JSON from gh CLI
    it('should throw parse error when gh returns truncated JSON', async () => {
      const mockSpawn = TerminalTestHelper.mockSpawn('[{"number":1', '', 0);
      setBunSpawn(mockSpawn);

      await expect(service.listPRs('owner', 'repo')).rejects.toThrow(
        /Failed to parse PR list response/,
      );
    });

    // GH-BC-2: Empty array response
    it('should return empty array when gh returns []', async () => {
      const mockSpawn = TerminalTestHelper.mockSpawn('[]', '', 0);
      setBunSpawn(mockSpawn);

      const result = await service.listPRs('owner', 'repo');
      expect(result).toEqual([]);
    });

    // GH-BC-3: Empty object for PR detail
    it('should return empty object when gh pr view returns {}', async () => {
      const mockSpawn = TerminalTestHelper.mockSpawn('{}', '', 0);
      setBunSpawn(mockSpawn);

      const result = await service.getPR('owner', 'repo', 1);
      expect(result).toEqual({});
    });

    // GH-BC-4: Malformed GraphQL JSON
    it('should return [] when GraphQL response is unparseable', async () => {
      const mockSpawn = TerminalTestHelper.mockSpawn('{not-json', '', 0);
      setBunSpawn(mockSpawn);

      const result = await service.getPrReviewComments('owner', 'repo', 1);
      expect(result).toEqual([]);
    });
  });

  // ================================================================
  // getPrReviewComments — Behavior
  // ================================================================
  describe('getPrReviewComments', () => {
    describe('Behavior', () => {
      it('should flatten a single page of threads and stamp resolution flags', async () => {
        const graphqlResponse = {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: true,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 101,
                            author: { login: 'alice' },
                            body: 'resolved finding',
                            path: 'src/a.ts',
                            line: 10,
                            originalLine: 10,
                            createdAt: '2025-01-01T00:00:00Z',
                            replyTo: null,
                          },
                        ],
                      },
                    },
                    {
                      isResolved: false,
                      isOutdated: true,
                      comments: {
                        nodes: [
                          {
                            databaseId: 102,
                            author: { login: 'bob' },
                            body: 'outdated finding',
                            path: 'src/b.ts',
                            line: null,
                            originalLine: 42,
                            createdAt: '2025-01-02T00:00:00Z',
                            replyTo: null,
                          },
                        ],
                      },
                    },
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 103,
                            author: { login: 'carol' },
                            body: 'active finding',
                            path: 'src/c.ts',
                            line: 7,
                            originalLine: 7,
                            createdAt: '2025-01-03T00:00:00Z',
                            replyTo: null,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        };
        const mockSpawn = TerminalTestHelper.mockSpawn(
          JSON.stringify(graphqlResponse),
          '',
          0,
        );
        setBunSpawn(mockSpawn);

        const result = await service.getPrReviewComments('owner', 'repo', 1);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
          id: 101,
          user: { login: 'alice' },
          body: 'resolved finding',
          path: 'src/a.ts',
          line: 10,
          created_at: '2025-01-01T00:00:00Z',
          isResolved: true,
          isOutdated: false,
        });
        // line falls back to originalLine when line is null
        expect(result[1].line).toBe(42);
        expect(result[1].isResolved).toBe(false);
        expect(result[1].isOutdated).toBe(true);
        expect(result[2].isResolved).toBe(false);
        expect(result[2].isOutdated).toBe(false);
      });

      it('should accumulate threads across paginated GraphQL pages', async () => {
        const page1 = {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                  nodes: [
                    {
                      isResolved: false,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 1,
                            author: { login: 'alice' },
                            body: 'page1 comment',
                            path: 'a.ts',
                            line: 1,
                            originalLine: 1,
                            createdAt: '2025-01-01T00:00:00Z',
                            replyTo: null,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        };
        const page2 = {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: true,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 2,
                            author: { login: 'bob' },
                            body: 'page2 comment',
                            path: 'b.ts',
                            line: 2,
                            originalLine: 2,
                            createdAt: '2025-01-02T00:00:00Z',
                            replyTo: null,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        };

        const responses = [JSON.stringify(page1), JSON.stringify(page2)];
        const calls: string[][] = [];
        const mockSpawn = jest.fn((cmd: string[]) => {
          calls.push(cmd);
          const stdout = responses.shift() ?? '';
          return TerminalTestHelper.mockSpawn(stdout, '', 0)();
        });
        setBunSpawn(mockSpawn);

        const result = await service.getPrReviewComments('owner', 'repo', 1);

        expect(result).toHaveLength(2);
        expect(result.map((c) => c.id)).toEqual([1, 2]);
        expect(result[1].isResolved).toBe(true);

        // Verify the second call passed a cursor
        expect(calls).toHaveLength(2);
        const firstCallHasCursor = calls[0].some((a) =>
          a.startsWith('cursor='),
        );
        const secondCallHasCursor = calls[1].some(
          (a) => a === 'cursor=cursor-1',
        );
        expect(firstCallHasCursor).toBe(false);
        expect(secondCallHasCursor).toBe(true);
      });

      it('should flatten multi-comment threads and propagate flags + replyTo', async () => {
        const graphqlResponse = {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      isResolved: true,
                      isOutdated: false,
                      comments: {
                        nodes: [
                          {
                            databaseId: 200,
                            author: { login: 'alice' },
                            body: 'top-level',
                            path: 'src/a.ts',
                            line: 5,
                            originalLine: 5,
                            createdAt: '2025-01-01T00:00:00Z',
                            replyTo: null,
                          },
                          {
                            databaseId: 201,
                            author: { login: 'bob' },
                            body: 'reply',
                            path: 'src/a.ts',
                            line: 5,
                            originalLine: 5,
                            createdAt: '2025-01-01T01:00:00Z',
                            replyTo: { databaseId: 200 },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        };
        const mockSpawn = TerminalTestHelper.mockSpawn(
          JSON.stringify(graphqlResponse),
          '',
          0,
        );
        setBunSpawn(mockSpawn);

        const result = await service.getPrReviewComments('owner', 'repo', 1);

        expect(result).toHaveLength(2);
        // Both comments share the thread's flags
        expect(result[0].isResolved).toBe(true);
        expect(result[1].isResolved).toBe(true);
        expect(result[0].isOutdated).toBe(false);
        expect(result[1].isOutdated).toBe(false);
        // Top-level has no in_reply_to_id
        expect(result[0].in_reply_to_id).toBeUndefined();
        // Reply carries replyTo.databaseId
        expect(result[1].in_reply_to_id).toBe(200);
      });
    });

    describe('Error Handling', () => {
      it('should return [] when GraphQL call exits non-zero', async () => {
        const mockSpawn = TerminalTestHelper.mockSpawn(
          '',
          'rate limit exceeded',
          1,
        );
        setBunSpawn(mockSpawn);

        const result = await service.getPrReviewComments('owner', 'repo', 1);
        expect(result).toEqual([]);
      });

      it('should return [] when response lacks reviewThreads shape', async () => {
        const mockSpawn = TerminalTestHelper.mockSpawn(
          JSON.stringify({ data: { repository: null } }),
          '',
          0,
        );
        setBunSpawn(mockSpawn);

        const result = await service.getPrReviewComments('owner', 'repo', 1);
        expect(result).toEqual([]);
      });
    });
  });

  // ================================================================
  // URL Parsing
  // ================================================================
  describe('URL Parsing', () => {
    // GH-URL-1: HTTPS with trailing slash
    it('should return null for HTTPS URL with trailing slash', () => {
      const result = service.parseRepoUrl('https://github.com/owner/repo/');
      expect(result).toBeNull();
    });

    // GH-URL-2: HTTPS with .git suffix
    it('should parse HTTPS URL with .git suffix correctly', () => {
      const result = service.parseRepoUrl('https://github.com/owner/repo.git');
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        url: 'https://github.com/owner/repo',
      });
    });

    // GH-URL-3: SSH with ssh:// prefix
    it('should return null for SSH URL with ssh:// prefix format', () => {
      const result = service.parseRepoUrl('ssh://git@github.com/owner/repo');
      expect(result).toBeNull();
    });

    // GH-URL-4: Edge cases
    it('should handle URL edge cases correctly', () => {
      // Empty string
      expect(service.parseRepoUrl('')).toBeNull();

      // Whitespace only
      expect(service.parseRepoUrl('   ')).toBeNull();

      // URL with query params
      expect(
        service.parseRepoUrl('https://github.com/owner/repo?tab=code'),
      ).toBeNull();

      // Shorthand format
      expect(service.parseRepoUrl('owner/repo')).toEqual({
        owner: 'owner',
        repo: 'repo',
        url: 'https://github.com/owner/repo',
      });
    });
  });

  // ================================================================
  // Error Handling
  // ================================================================
  describe('Error Handling', () => {
    // GH-ERR-1: gh binary missing (spawn throws ENOENT)
    it('should handle missing gh binary gracefully across methods', async () => {
      const throwingSpawn = jest.fn(() => {
        throw new Error('spawn ENOENT');
      });
      setBunSpawn(throwingSpawn);

      // listPRs should throw with "gh binary not found" in the error chain
      await expect(service.listPRs('owner', 'repo')).rejects.toThrow(
        /gh binary not found/,
      );

      // isGhInstalled should return false
      expect(await service.isGhInstalled()).toBe(false);

      // getPrReviewComments should gracefully return []
      expect(await service.getPrReviewComments('owner', 'repo', 1)).toEqual([]);
    });

    // GH-ERR-2: gh not authenticated
    it('should handle unauthenticated gh CLI correctly', async () => {
      const routedSpawn = createRoutedSpawn({
        'auth status': {
          exitCode: 1,
          stderr: 'not logged in',
        },
        'pr list': {
          exitCode: 1,
          stderr: 'not logged in to any GitHub hosts',
        },
      });
      setBunSpawn(routedSpawn);

      // isAuthenticated should return false
      expect(await service.isAuthenticated()).toBe(false);

      // listPRs should throw with stderr message
      await expect(service.listPRs('owner', 'repo')).rejects.toThrow(
        /not logged in to any GitHub hosts/,
      );
    });
  });
});
