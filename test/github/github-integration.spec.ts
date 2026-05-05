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

    // GH-BC-4: Nested arrays from paginated slurp
    it('should return nested arrays from paginated --slurp response without flattening', async () => {
      const mockSpawn = TerminalTestHelper.mockSpawn(
        '[[{"id":1}],[{"id":2}]]',
        '',
        0,
      );
      setBunSpawn(mockSpawn);

      const result = await service.getPrReviewComments('owner', 'repo', 1);
      expect(result).toEqual([[{ id: 1 }], [{ id: 2 }]]);
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
