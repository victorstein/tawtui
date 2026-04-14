/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import {
  IntegrationHelper,
  type SlackStack,
} from '../helpers/integration.helper';
import { SlackTestHelper } from '../helpers/slack-test.helper';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { OracleState } from '../../src/modules/slack/slack.types';

/**
 * Build a mock fetch that responds based on URL pattern.
 * Each handler returns a Response-like object that slackGet can consume.
 */
function createRoutedFetch(
  routes: Record<string, () => object | Response>,
): jest.Mock {
  return jest.fn((url: string) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const result = handler();
        if (result instanceof Response) {
          return Promise.resolve(result);
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          headers: new Headers(),
          json: async () => result,
        });
      }
    }
    // Default: return empty ok response
    return Promise.resolve({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    });
  });
}

/**
 * Build a delayed mock fetch that adds configurable delays per route.
 * The returned object includes the mock and a way to resolve pending responses.
 */
function createDelayedRoutedFetch(
  routes: Record<
    string,
    { response: () => object | Response; delayMs?: number }
  >,
): jest.Mock {
  return jest.fn((url: string) => {
    for (const [pattern, config] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const result = config.response();
        if (result instanceof Response) {
          if (config.delayMs) {
            return new Promise<Response>((resolve) =>
              setTimeout(() => resolve(result), config.delayMs),
            );
          }
          return Promise.resolve(result);
        }
        const response = {
          status: 200,
          ok: true,
          headers: new Headers(),
          json: async () => result,
        };
        if (config.delayMs) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(response), config.delayMs),
          );
        }
        return Promise.resolve(response);
      }
    }
    return Promise.resolve({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    });
  });
}

// Standard conversations and responses for reuse
const testChannel = SlackTestHelper.conversation({
  id: 'C001',
  name: 'general',
});

const testChannel2 = SlackTestHelper.conversation({
  id: 'C002',
  name: 'random',
});

function standardRoutes() {
  return {
    'conversations.list': () =>
      SlackTestHelper.conversationsListResponse([testChannel]),
    'search.messages': () => SlackTestHelper.searchResponse(['C001']),
    'conversations.history': () =>
      SlackTestHelper.historyResponse([
        { text: 'hello', ts: '1700000001.000000', user: 'U100' },
        { text: 'world', ts: '1700000002.000000', user: 'U100' },
      ]),
    'users.info': () => ({
      ok: true,
      user: {
        id: 'U100',
        name: 'testuser',
        profile: { display_name: 'Test User' },
      },
    }),
  };
}

describe('SlackIngestionService Integration', () => {
  let stack: SlackStack;
  let savedFetch: typeof global.fetch;
  let savedBun: unknown;

  beforeEach(() => {
    jest.clearAllMocks();

    // Save and mock globals
    savedFetch = global.fetch;
    savedBun = (globalThis as Record<string, unknown>).Bun;
    (globalThis as Record<string, unknown>).Bun = {
      spawn: jest.fn().mockReturnValue({
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      }),
      spawnSync: jest.fn().mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      }),
      hash: jest.fn().mockReturnValue(0),
    };
  });

  afterEach(async () => {
    stack?.ingestionService.abort();
    stack?.ingestionService.stopPolling();
    // Drain any pending requests in the SlackService queue.
    // The abort() above causes shouldAbort to return true, making
    // abortableSleep throw, which rejects queued promises.
    try {
      await (stack?.slackService as any)?.requestQueue;
    } catch {
      // Expected: aborted requests throw 'Slack API call aborted'
    }
    // Allow any remaining microtasks/timers to settle
    await new Promise((resolve) => setTimeout(resolve, 100));
    stack?.cleanup();
    global.fetch = savedFetch;
    (globalThis as Record<string, unknown>).Bun = savedBun;
  });

  // ================================================================
  // Race Conditions
  // ================================================================
  describe('Race Conditions', () => {
    // RC-1: Manual sync during poll timer
    describe('RC-1: Manual sync during poll timer', () => {
      it('should return empty result from triggerIngest when safeIngest is in-flight', async () => {
        // Given: a stack with delayed fetch mocks so the ingestion is still
        // in-flight when triggerIngest() is called at the 80ms mark
        global.fetch = createDelayedRoutedFetch({
          'conversations.list': {
            response: () =>
              SlackTestHelper.conversationsListResponse([testChannel]),
            delayMs: 200,
          },
          'search.messages': {
            response: () => SlackTestHelper.searchResponse(['C001']),
          },
          'conversations.history': {
            response: () =>
              SlackTestHelper.historyResponse([
                { text: 'hello', ts: '1700000001.000000', user: 'U100' },
                { text: 'world', ts: '1700000002.000000', user: 'U100' },
              ]),
          },
          'users.info': {
            response: () => ({
              ok: true,
              user: {
                id: 'U100',
                name: 'testuser',
                profile: { display_name: 'Test User' },
              },
            }),
          },
        }) as any;
        stack = IntegrationHelper.createSlackStack();

        // Start polling with a very short interval (50ms)
        stack.ingestionService.startPolling(50);

        // Wait for safeIngest to start (the timer fires after 50ms)
        await new Promise((resolve) => setTimeout(resolve, 80));

        // When: triggerIngest is called while safeIngest is in-flight
        const result = await stack.ingestionService.triggerIngest();

        // Then: triggerIngest should return empty because _ingesting is true
        // (safeIngest is already running, so the guard returns early)
        expect(result).toEqual({ messagesStored: 0, channelNames: [] });
      });
    });

    // RC-2: Rapid double triggerIngest
    describe('RC-2: Rapid double triggerIngest', () => {
      it('should only complete one full cycle when triggerIngest is called twice rapidly', async () => {
        // Given: a stack with standard fetch mocks that include some delay
        // to ensure the first call is still running when the second arrives
        const routes = {
          'conversations.list': {
            response: () =>
              SlackTestHelper.conversationsListResponse([testChannel]),
            delayMs: 10,
          },
          'search.messages': {
            response: () => SlackTestHelper.searchResponse(['C001']),
            delayMs: 10,
          },
          'conversations.history': {
            response: () =>
              SlackTestHelper.historyResponse([
                { text: 'hello', ts: '1700000001.000000', user: 'U100' },
              ]),
            delayMs: 10,
          },
          'users.info': {
            response: () => ({
              ok: true,
              user: {
                id: 'U100',
                name: 'testuser',
                profile: { display_name: 'Test User' },
              },
            }),
          },
        };
        global.fetch = createDelayedRoutedFetch(routes) as any;
        stack = IntegrationHelper.createSlackStack();

        // When: triggerIngest is called twice in rapid succession
        const [result1, result2] = await Promise.all([
          stack.ingestionService.triggerIngest(),
          stack.ingestionService.triggerIngest(),
        ]);

        // Then: one should complete with messages, the other should return empty
        const results = [result1, result2];
        const successResult = results.find((r) => r.messagesStored > 0);
        const emptyResult = results.find((r) => r.messagesStored === 0);

        expect(successResult).toBeDefined();
        expect(successResult!.messagesStored).toBeGreaterThan(0);
        expect(emptyResult).toBeDefined();
        expect(emptyResult!.messagesStored).toBe(0);
        expect(emptyResult!.channelNames).toEqual([]);

        // Verify conversations.list was only called once (one full ingestion cycle, not two).
        // conversations.history may be called more than once per cycle due to thread
        // bootstrapping in Phase 2, so we check conversations.list which is called
        // exactly once per ingestion cycle.
        const conversationsListCalls = (
          global.fetch as jest.Mock
        ).mock.calls.filter((call: string[]) =>
          String(call[0]).includes('conversations.list'),
        );
        expect(conversationsListCalls).toHaveLength(1);
      });
    });

    // RC-3: Abort during rate-limit sleep
    describe('RC-3: Abort during rate-limit sleep', () => {
      it('should abort quickly during rate-limit sleep and not corrupt state', async () => {
        // Given: fetch returns 429 with Retry-After: 10 seconds
        let waitDetected = false;
        const rateLimitRoutes = {
          'conversations.list': {
            response: () =>
              SlackTestHelper.conversationsListResponse([testChannel]),
          },
          'search.messages': {
            response: () => SlackTestHelper.searchResponse(['C001']),
          },
          'conversations.history': {
            response: () => SlackTestHelper.rateLimitResponse(10),
          },
          'users.info': {
            response: () => ({
              ok: true,
              user: {
                id: 'U100',
                name: 'testuser',
                profile: { display_name: 'Test User' },
              },
            }),
          },
        };
        global.fetch = createDelayedRoutedFetch(rateLimitRoutes) as any;
        stack = IntegrationHelper.createSlackStack();

        // Set up onWait to detect when rate-limit sleep begins
        stack.slackService.onWait = (info) => {
          if (info.reason === 'rate-limited') {
            waitDetected = true;
          }
        };

        // When: start ingestion and abort after rate-limit wait is detected
        const startTime = Date.now();
        const ingestPromise = stack.ingestionService.triggerIngest();

        // Wait for the rate-limit wait to begin (poll every 50ms, safety limit 3s)
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            clearInterval(check);
            clearTimeout(safetyTimer);
            resolve();
          };
          const check = setInterval(() => {
            if (waitDetected) done();
          }, 50);
          const safetyTimer = setTimeout(done, 3000);
        });

        // Verify we actually observed the rate-limit wait before aborting
        expect(waitDetected).toBe(true);

        // Abort the ingestion
        stack.ingestionService.abort();

        const result = await ingestPromise;
        const elapsed = Date.now() - startTime;

        // Then: should return quickly (well under the 10s Retry-After)
        expect(elapsed).toBeLessThan(5000);
        expect(result.messagesStored).toBe(0);
        expect(result.channelNames).toEqual([]);

        // Verify state file is not corrupted
        if (existsSync(stack.statePath)) {
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          expect(() => JSON.parse(stateRaw)).not.toThrow();
        }
      });
    });

    // RC-4: resetState during active ingestion
    describe('RC-4: resetState during active ingestion', () => {
      it('should abort ingestion and leave clean state when resetState is called mid-ingest', async () => {
        // Given: two channels with slow responses so we can call resetState mid-ingest
        let firstChannelStarted = false;

        const slowRoutes: Record<
          string,
          { response: () => object | Response; delayMs?: number }
        > = {
          'conversations.list': {
            response: () =>
              SlackTestHelper.conversationsListResponse([
                testChannel,
                testChannel2,
              ]),
          },
          'search.messages': {
            response: () => SlackTestHelper.searchResponse(['C001', 'C002']),
          },
          'conversations.history': {
            response: () => {
              firstChannelStarted = true;
              return SlackTestHelper.historyResponse([
                { text: 'msg', ts: '1700000001.000000', user: 'U100' },
              ]);
            },
            delayMs: 100, // Slow enough to allow resetState to fire
          },
          'users.info': {
            response: () => ({
              ok: true,
              user: {
                id: 'U100',
                name: 'testuser',
                profile: { display_name: 'Test User' },
              },
            }),
          },
        };
        global.fetch = createDelayedRoutedFetch(slowRoutes) as any;
        stack = IntegrationHelper.createSlackStack();

        // When: start ingestion and call resetState after the first channel fetch is dispatched
        const ingestPromise = stack.ingestionService.triggerIngest();

        // Wait for the first history fetch to be dispatched (poll every 20ms, safety limit 2s)
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            clearInterval(check);
            clearTimeout(safetyTimer);
            resolve();
          };
          const check = setInterval(() => {
            if (firstChannelStarted) done();
          }, 20);
          const safetyTimer = setTimeout(done, 2000);
        });

        // Reset state while ingestion is running
        stack.ingestionService.resetState();

        const result = await ingestPromise;

        // Then: ingestion should return empty or partial result
        // The generation check causes it to bail out with empty results
        expect(result.messagesStored).toBe(0);
        expect(result.channelNames).toEqual([]);

        // Verify state file has no stale cursors from aborted fetch
        if (existsSync(stack.statePath)) {
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          const state: OracleState = JSON.parse(stateRaw);
          // channelCursors should be empty (reset clears them)
          expect(state.channelCursors).toEqual({});
        }
      });
    });
  });

  // ================================================================
  // Boundary Corruption
  // ================================================================
  describe('Boundary Corruption', () => {
    // BC-1: API returns wrong shape
    describe('BC-1: API returns wrong shape', () => {
      it('should return empty array when conversations.history response has no messages field', async () => {
        // Given: fetch returns { ok: true } with no messages field for conversations.history
        global.fetch = createRoutedFetch({
          'conversations.history': () => ({ ok: true }),
        }) as any;
        stack = IntegrationHelper.createSlackStack();

        // When: getMessagesSince is called
        const result = await stack.slackService.getMessagesSince(
          'C001',
          '1700000000.000000',
        );

        // Then: returns empty array without throwing TypeError
        expect(result).toEqual([]);
      });
    });

    // BC-2: Empty state file (0 bytes)
    describe('BC-2: Empty state file (0 bytes)', () => {
      it('should treat empty state file as fresh state and proceed normally', async () => {
        // Given: an empty (0-byte) state file
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();
        writeFileSync(stack.statePath, '');

        // When: ingest is called
        const result = await stack.ingestionService.ingest();

        // Then: treats as fresh state, ingestion proceeds normally
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');
      });
    });

    // BC-3: State file has wrong schema
    describe('BC-3: State file has wrong schema', () => {
      it('should handle state file with channelCursors as wrong type', async () => {
        // Given: state file has valid JSON but wrong schema for channelCursors
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();
        writeFileSync(
          stack.statePath,
          JSON.stringify({
            channelCursors: 'not-an-object',
            lastChecked: 12345,
          }),
        );

        // When: ingest is called
        const result = await stack.ingestionService.ingest();

        // Then: handles gracefully — resets to defaults and proceeds
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');
      });
    });

    // BC-4: API returns HTML instead of JSON
    describe('BC-4: API returns HTML instead of JSON', () => {
      it('should throw a clear error when Slack returns HTML instead of JSON', async () => {
        // Given: fetch returns an HTML response instead of JSON
        global.fetch = createRoutedFetch({
          'conversations.list': () =>
            new Response('<html>Login</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
        }) as any;
        stack = IntegrationHelper.createSlackStack();

        // When/Then: calling getConversations should throw a clear error
        await expect(
          stack.slackService.getConversations(),
        ).rejects.toThrow(/non-JSON response/);
      });
    });

    // BC-5: Staging file with partial content
    describe('BC-5: Staging file with partial content', () => {
      it('should still return results when mine fails due to corrupt staging files', async () => {
        // Given: a stack with valid fetch routes
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();

        // Write a truncated JSON file to staging dir to cause mine to fail
        writeFileSync(
          join(stack.stagingDir, 'corrupt-file.json'),
          '[{"type":"message"',
        );

        // Mock Bun.spawn to fail for mempalace mine (simulating mine crashing on corrupt file)
        (globalThis as Record<string, unknown>).Bun = {
          spawn: jest.fn().mockReturnValue({
            exited: Promise.resolve(1),
            stdout: new ReadableStream(),
            stderr: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('JSON parse error'),
                );
                controller.close();
              },
            }),
          }),
          spawnSync: jest.fn().mockReturnValue({
            exitCode: 0,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
          }),
          hash: jest.fn().mockReturnValue(0),
        };

        // When: ingest is called (will fetch messages, write files, then mine fails)
        const result = await stack.ingestionService.ingest();

        // Then: ingestion still returns results even though mine failed
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');
      });
    });
  });

  // ================================================================
  // State Machine Violations
  // ================================================================
  describe('State Machine Violations', () => {
    // SM-1: Oracle session gating via onFirstIngestComplete
    describe('SM-1: Oracle session gating via onFirstIngestComplete', () => {
      it('should fire onFirstIngestComplete callback after first successful safeIngest', async () => {
        // Given: a fresh stack with hasCompletedSync = false
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();

        expect(stack.ingestionService.hasCompletedSync).toBe(false);

        // Set onFirstIngestComplete callback
        const callback = jest.fn();
        stack.ingestionService.onFirstIngestComplete = callback;

        // When: safeIngest runs to completion (via private access)
        await (stack.ingestionService as any).safeIngest();

        // Then: callback fired and hasCompletedSync is true
        expect(callback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.hasCompletedSync).toBe(true);
        // onFirstIngestComplete is cleared after firing
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();

        // Phase 2: Prove onFirstIngestComplete is re-registerable after reset
        // When: resetState is called
        stack.ingestionService.resetState();

        // hasCompletedSync should be false again after reset
        expect(stack.ingestionService.hasCompletedSync).toBe(false);

        // Set a new callback (fetch mocks are still active from above)
        const secondCallback = jest.fn();
        stack.ingestionService.onFirstIngestComplete = secondCallback;

        // Run another ingestion cycle
        await (stack.ingestionService as any).safeIngest();

        // Then: the new callback fires, proving re-registration works
        expect(secondCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.hasCompletedSync).toBe(true);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();
        // Original callback was not called again
        expect(callback).toHaveBeenCalledTimes(1);
      });
    });

    // SM-2: onFirstIngestComplete lifecycle after reset
    describe('SM-2: onFirstIngestComplete lifecycle after reset', () => {
      it('should allow re-registering onFirstIngestComplete after resetState', async () => {
        // Given: a stack that completes a first ingest
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();

        const firstCallback = jest.fn();
        stack.ingestionService.onFirstIngestComplete = firstCallback;

        // Complete first ingest via safeIngest
        await (stack.ingestionService as any).safeIngest();
        expect(firstCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();

        // When: reset state and register a new callback
        stack.ingestionService.resetState();

        const secondCallback = jest.fn();
        stack.ingestionService.onFirstIngestComplete = secondCallback;

        // Complete another ingest via safeIngest
        await (stack.ingestionService as any).safeIngest();

        // Then: the new callback fires (proving re-registration works after reset)
        expect(secondCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();
        // First callback was not called again
        expect(firstCallback).toHaveBeenCalledTimes(1);
      });
    });

    // SM-3: Double startPolling
    describe('SM-3: Double startPolling is idempotent', () => {
      it('should not leak a second timer when startPolling is called twice', async () => {
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();

        // When: startPolling is called twice
        stack.ingestionService.startPolling(60000);
        stack.ingestionService.startPolling(60000);

        // Then: isPolling is true
        expect(stack.ingestionService.isPolling()).toBe(true);

        // When: stopPolling is called once
        stack.ingestionService.stopPolling();

        // Then: isPolling is false (no leaked second timer)
        expect(stack.ingestionService.isPolling()).toBe(false);
      });
    });
  });

  // ================================================================
  // Failure Cascades
  // ================================================================
  describe('Failure Cascades', () => {
    // FC-1: Mid-fetch channel failure (8 channels, channel 3 fails)
    describe('FC-1: Mid-fetch channel failure', () => {
      it(
        'should skip the failed channel and complete the other 7',
        async () => {
          // Given: 8 channels pre-cached in state, with activeChannelIds set
          const channels = Array.from({ length: 8 }, (_, i) =>
            SlackTestHelper.conversation({
              id: `C00${i + 1}`,
              name: `channel-${i + 1}`,
            }),
          );
          const channelIds = channels.map((c) => c.id);

          const initialState = SlackTestHelper.oracleState({
            conversations: channels,
            activeChannelIds: channelIds,
            channelsCachedAt: new Date().toISOString(),
            activeChannelsCachedAt: new Date().toISOString(),
          });

          // Route fetch: channel 3 (C003) returns 500, others succeed
          global.fetch = jest.fn((url: string) => {
            if (
              typeof url === 'string' &&
              url.includes('conversations.history')
            ) {
              const channelMatch = url.match(/channel=([^&]+)/);
              if (channelMatch?.[1] === 'C003') {
                return Promise.resolve({
                  status: 500,
                  ok: false,
                  statusText: 'Internal Server Error',
                  headers: new Headers(),
                  json: async () => ({ ok: false, error: 'internal_error' }),
                });
              }
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: `msg in ${channelMatch?.[1]}`,
                      ts: '1700000001.000000',
                      user: 'U100',
                    },
                  ]),
              });
            }
            if (typeof url === 'string' && url.includes('search.messages')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => SlackTestHelper.searchResponse(channelIds),
              });
            }
            if (typeof url === 'string' && url.includes('users.info')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({
                  ok: true,
                  user: {
                    id: 'U100',
                    name: 'testuser',
                    profile: { display_name: 'Test User' },
                  },
                }),
              });
            }
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () => ({ ok: true }),
            });
          }) as any;

          stack = IntegrationHelper.createSlackStack({ initialState });

          // Track progress callbacks
          const progressCalls: Array<{ phase: string; channel?: string }> = [];

          // When: run ingestion
          const result = await stack.ingestionService.ingest((info) => {
            progressCalls.push({ phase: info.phase, channel: info.channel });
          });

          // Then: 7 channels succeeded, channel 3 was skipped
          expect(result.messagesStored).toBe(7);
          expect(result.channelNames).toHaveLength(7);
          expect(result.channelNames).not.toContain('channel-3');

          // 7 staging files written (not 8)
          const { readdirSync } = await import('fs');
          const stagingFiles = readdirSync(stack.stagingDir).filter(
            (f: string) => f.endsWith('.json'),
          );
          expect(stagingFiles).toHaveLength(7);

          // State file: 7 cursors, C003 absent
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          const state: OracleState = JSON.parse(stateRaw);
          expect(Object.keys(state.channelCursors)).toHaveLength(7);
          expect(state.channelCursors['C003']).toBeUndefined();
          // Other channels have cursors
          for (const id of channelIds.filter((cid) => cid !== 'C003')) {
            expect(state.channelCursors[id]).toBeDefined();
          }

          // Progress callbacks fired for channel phases (including attempts for all 8)
          const channelProgressCalls = progressCalls.filter(
            (p) => p.phase === 'channel' && p.channel,
          );
          const channelsReported = new Set(
            channelProgressCalls.map((p) => p.channel),
          );
          // All 8 channels should have had a progress callback (channel phase fires before fetch)
          expect(channelsReported.size).toBe(8);
        },
        30000,
      );
    });

    // FC-2: Thread bootstrap failure
    describe('FC-2: Thread bootstrap failure', () => {
      it(
        'should bootstrap threads for channel B when channel A bootstrap fails',
        async () => {
          // Given: 2 channels with cursors but no tracked threads
          // This triggers Phase 2 thread bootstrap
          const channelA = SlackTestHelper.conversation({
            id: 'C_A',
            name: 'chan-a',
          });
          const channelB = SlackTestHelper.conversation({
            id: 'C_B',
            name: 'chan-b',
          });

          // Use a recent cursor so Phase 2 bootstrap backfill has valid time range
          const initialCursor = String(Math.floor(Date.now() / 1000) - 3600);

          const initialState = SlackTestHelper.oracleState({
            lastChecked: new Date().toISOString(),
            conversations: [channelA, channelB],
            activeChannelIds: ['C_A', 'C_B'],
            channelsCachedAt: new Date().toISOString(),
            activeChannelsCachedAt: new Date().toISOString(),
            // Cursors set so Phase 1 will fetch, and Phase 2 will bootstrap threads
            channelCursors: {
              C_A: initialCursor + '.000000',
              C_B: initialCursor + '.000000',
            },
            // No trackedThreads — triggers bootstrap in Phase 2
          });

          // Use recent timestamps so threads aren't pruned (must be within 30 days)
          const recentTs = String(Math.floor(Date.now() / 1000) - 86400); // 1 day ago
          const cursorTs = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago

          global.fetch = jest.fn((url: string) => {
            if (
              typeof url === 'string' &&
              url.includes('conversations.history')
            ) {
              const channelMatch = url.match(/channel=([^&]+)/);
              const oldestMatch = url.match(/oldest=([^&]+)/);
              const channel = channelMatch?.[1] ?? 'unknown';
              const oldest = oldestMatch?.[1]
                ? parseFloat(oldestMatch[1])
                : 0;

              // Phase 2 bootstrap uses a backfill cursor that's much earlier
              // (channelCursor - 30 days in seconds). The cursor is ~now,
              // so bootstrap oldest will be ~30 days ago. Phase 1 oldest is
              // the cursor from initial state (1700000000). Distinguish by
              // checking if oldest is significantly older than the cursor.
              const cursorFloat = parseFloat(cursorTs);
              const isBootstrap = oldest < cursorFloat - 1000000;

              if (isBootstrap) {
                if (channel === 'C_A') {
                  // Channel A bootstrap fails
                  return Promise.resolve({
                    status: 500,
                    ok: false,
                    statusText: 'Internal Server Error',
                    headers: new Headers(),
                    json: async () => ({ ok: false }),
                  });
                }
                // Channel B bootstrap succeeds with a threaded parent message
                return Promise.resolve({
                  status: 200,
                  ok: true,
                  headers: new Headers(),
                  json: async () =>
                    SlackTestHelper.historyResponse([
                      {
                        text: 'thread parent',
                        ts: recentTs + '.000000',
                        user: 'U100',
                        reply_count: 3,
                      },
                    ]),
                });
              }

              // Phase 1: both channels return simple messages (no threads)
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: 'phase1 msg',
                      ts: cursorTs + '.000000',
                      user: 'U100',
                    },
                  ]),
              });
            }
            if (
              typeof url === 'string' &&
              url.includes('conversations.replies')
            ) {
              // Thread replies for the bootstrap thread parent
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({
                  ok: true,
                  messages: [
                    {
                      ts: recentTs + '.000000',
                      user: 'U100',
                      text: 'thread parent',
                      thread_ts: recentTs + '.000000',
                    },
                    {
                      ts: recentTs + '.000001',
                      user: 'U100',
                      text: 'reply 1',
                      thread_ts: recentTs + '.000000',
                    },
                  ],
                  has_more: false,
                }),
              });
            }
            if (typeof url === 'string' && url.includes('search.messages')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.searchResponse(['C_A', 'C_B']),
              });
            }
            if (typeof url === 'string' && url.includes('users.info')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({
                  ok: true,
                  user: {
                    id: 'U100',
                    name: 'testuser',
                    profile: { display_name: 'Test User' },
                  },
                }),
              });
            }
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () => ({ ok: true }),
            });
          }) as any;

          stack = IntegrationHelper.createSlackStack({ initialState });

          // When: run ingestion
          const result = await stack.ingestionService.ingest();

          // Then: ingestion completes without crash
          expect(result.messagesStored).toBeGreaterThan(0);

          // Read state to verify thread bootstrap results
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          const state: OracleState = JSON.parse(stateRaw);

          // Channel B should have tracked threads (bootstrap succeeded)
          expect(state.trackedThreads?.['C_B']).toBeDefined();
          expect(state.trackedThreads!['C_B'].length).toBeGreaterThan(0);

          // Channel A should have no tracked threads (bootstrap failed)
          const chanAThreads = state.trackedThreads?.['C_A'];
          expect(!chanAThreads || chanAThreads.length === 0).toBe(true);
        },
        30000,
      );
    });

    // FC-3: Mine failure after successful fetch
    describe('FC-3: Mine failure after successful fetch', () => {
      it('should preserve state and staging files when mine throws', async () => {
        // Given: valid fetch routes for successful ingestion
        global.fetch = createRoutedFetch(standardRoutes()) as any;
        stack = IntegrationHelper.createSlackStack();

        // Mock Bun.spawn to fail for mempalace mine
        (globalThis as Record<string, unknown>).Bun = {
          spawn: jest.fn().mockReturnValue({
            exited: Promise.resolve(1),
            stdout: new ReadableStream(),
            stderr: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('mempalace mine failed'),
                );
                controller.close();
              },
            }),
          }),
          spawnSync: jest.fn().mockReturnValue({
            exitCode: 0,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
          }),
          hash: jest.fn().mockReturnValue(0),
        };

        // When: ingest runs (fetch succeeds, mine fails)
        const result = await stack.ingestionService.ingest();

        // Then: ingestion still returns results (mine failure is caught)
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');

        // State was saved BEFORE mine — cursors exist
        const stateRaw = readFileSync(stack.statePath, 'utf-8');
        const state: OracleState = JSON.parse(stateRaw);
        expect(Object.keys(state.channelCursors).length).toBeGreaterThan(0);
        expect(state.channelCursors['C001']).toBeDefined();
        expect(state.lastChecked).not.toBeNull();

        // Staging files exist on disk (mine didn't clean them up)
        const { readdirSync } = await import('fs');
        const stagingFiles = readdirSync(stack.stagingDir).filter(
          (f: string) => f.endsWith('.json'),
        );
        expect(stagingFiles.length).toBeGreaterThan(0);
      });
    });

    // FC-4: 401 mid-ingestion
    describe('FC-4: 401 mid-ingestion', () => {
      it(
        'should skip the 401 channel and complete other channels',
        async () => {
          // Given: 8 channels pre-cached in state
          const channels = Array.from({ length: 8 }, (_, i) =>
            SlackTestHelper.conversation({
              id: `C10${i + 1}`,
              name: `auth-chan-${i + 1}`,
            }),
          );
          const channelIds = channels.map((c) => c.id);

          const initialState = SlackTestHelper.oracleState({
            conversations: channels,
            activeChannelIds: channelIds,
            channelsCachedAt: new Date().toISOString(),
            activeChannelsCachedAt: new Date().toISOString(),
          });

          // Route fetch: channel 5 (C105) returns 401, others succeed
          global.fetch = jest.fn((url: string) => {
            if (
              typeof url === 'string' &&
              url.includes('conversations.history')
            ) {
              const channelMatch = url.match(/channel=([^&]+)/);
              if (channelMatch?.[1] === 'C105') {
                return Promise.resolve({
                  status: 401,
                  ok: false,
                  statusText: 'Unauthorized',
                  headers: new Headers(),
                  json: async () => ({
                    ok: false,
                    error: 'invalid_auth',
                  }),
                });
              }
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: `msg in ${channelMatch?.[1]}`,
                      ts: '1700000001.000000',
                      user: 'U200',
                    },
                  ]),
              });
            }
            if (typeof url === 'string' && url.includes('search.messages')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => SlackTestHelper.searchResponse(channelIds),
              });
            }
            if (typeof url === 'string' && url.includes('users.info')) {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({
                  ok: true,
                  user: {
                    id: 'U200',
                    name: 'authuser',
                    profile: { display_name: 'Auth User' },
                  },
                }),
              });
            }
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () => ({ ok: true }),
            });
          }) as any;

          stack = IntegrationHelper.createSlackStack({ initialState });

          // When: run ingestion
          const result = await stack.ingestionService.ingest();

          // Then: 7 channels completed, channel 5 was skipped due to 401
          expect(result.messagesStored).toBe(7);
          expect(result.channelNames).toHaveLength(7);
          expect(result.channelNames).not.toContain('auth-chan-5');

          // State: 7 cursors, C105 absent
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          const state: OracleState = JSON.parse(stateRaw);
          expect(Object.keys(state.channelCursors)).toHaveLength(7);
          expect(state.channelCursors['C105']).toBeUndefined();

          // Other channels have cursors
          for (const id of channelIds.filter((cid) => cid !== 'C105')) {
            expect(state.channelCursors[id]).toBeDefined();
          }
        },
        30000,
      );
    });
  });
});
