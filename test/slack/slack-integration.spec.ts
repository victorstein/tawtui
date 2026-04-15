/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import {
  IntegrationHelper,
  type SlackStack,
} from '../helpers/integration.helper';
import { SlackTestHelper } from '../helpers/slack-test.helper';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { OracleState } from '../../src/modules/slack/slack.types';
import type { SlackIngestionService } from '../../src/modules/slack/slack-ingestion.service';

interface IngestionServicePrivate {
  safeIngest(): Promise<void>;
}

function asPrivate(s: SlackIngestionService): IngestionServicePrivate {
  return s as unknown as IngestionServicePrivate;
}

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

        // Wait for the rate-limit wait to begin (poll every 50ms, safety limit 10s)
        // Note: multiple search.messages calls (active + mention detection) each
        // have a 3s throttle, so we need more time before conversations.history fires
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
          const safetyTimer = setTimeout(done, 10000);
        });

        // Verify we actually observed the rate-limit wait before aborting
        expect(waitDetected).toBe(true);

        // Abort the ingestion
        stack.ingestionService.abort();

        const result = await ingestPromise;
        const elapsed = Date.now() - startTime;

        // Then: should return quickly after abort (well under the 10s Retry-After).
        // Total elapsed includes search.messages throttle (~6s for active + mention detection)
        // plus the time to detect and abort the rate-limit sleep.
        expect(elapsed).toBeLessThan(15000);
        expect(result.messagesStored).toBe(0);
        expect(result.channelNames).toEqual([]);

        // Verify state file is not corrupted
        if (existsSync(stack.statePath)) {
          const stateRaw = readFileSync(stack.statePath, 'utf-8');
          expect(() => JSON.parse(stateRaw)).not.toThrow();
        }
      }, 15000);
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
        await expect(stack.slackService.getConversations()).rejects.toThrow(
          /non-JSON response/,
        );
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
        await asPrivate(stack.ingestionService).safeIngest();

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
        await asPrivate(stack.ingestionService).safeIngest();

        // Then: the new callback fires, proving re-registration works
        expect(secondCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.hasCompletedSync).toBe(true);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();
        // Original callback was not called again
        expect(callback).toHaveBeenCalledTimes(1);
      }, 30000);
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
        await asPrivate(stack.ingestionService).safeIngest();
        expect(firstCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();

        // When: reset state and register a new callback
        stack.ingestionService.resetState();

        const secondCallback = jest.fn();
        stack.ingestionService.onFirstIngestComplete = secondCallback;

        // Complete another ingest via safeIngest
        await asPrivate(stack.ingestionService).safeIngest();

        // Then: the new callback fires (proving re-registration works after reset)
        expect(secondCallback).toHaveBeenCalledTimes(1);
        expect(stack.ingestionService.onFirstIngestComplete).toBeNull();
        // First callback was not called again
        expect(firstCallback).toHaveBeenCalledTimes(1);
      }, 30000);
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
      it('should skip the failed channel and complete the other 7', async () => {
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
        const stagingFiles = readdirSync(stack.stagingDir).filter((f: string) =>
          f.endsWith('.json'),
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
      }, 30000);
    });

    // FC-2: Thread bootstrap failure
    describe('FC-2: Thread bootstrap failure', () => {
      it('should bootstrap threads for channel B when channel A bootstrap fails', async () => {
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
            const oldest = oldestMatch?.[1] ? parseFloat(oldestMatch[1]) : 0;

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
              json: async () => SlackTestHelper.searchResponse(['C_A', 'C_B']),
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
      }, 30000);
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
        const stagingFiles = readdirSync(stack.stagingDir).filter((f: string) =>
          f.endsWith('.json'),
        );
        expect(stagingFiles.length).toBeGreaterThan(0);
      });
    });

    // FC-4: 401 mid-ingestion
    describe('FC-4: 401 mid-ingestion', () => {
      it('should skip the 401 channel and complete other channels', async () => {
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
      }, 30000);
    });
  });

  // ================================================================
  // Full-Stack Behavioral
  // ================================================================
  describe('Full-Stack Behavioral', () => {
    const testChannel3 = SlackTestHelper.conversation({
      id: 'C003',
      name: 'engineering',
    });

    // FS-1: First launch end-to-end
    describe('FS-1: First launch end-to-end', () => {
      it('should complete full first-launch cycle with correct progress ordering and file output', async () => {
        // Given: fresh stack with no state file, no staging dir
        // 3 channels returned by conversations.list, 2 active (C001, C002)
        global.fetch = jest.fn((url: string) => {
          if (typeof url === 'string' && url.includes('conversations.list')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () =>
                SlackTestHelper.conversationsListResponse([
                  testChannel,
                  testChannel2,
                  testChannel3,
                ]),
            });
          }
          if (typeof url === 'string' && url.includes('search.messages')) {
            // Active channel detection: from:me query returns C001 and C002
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () =>
                SlackTestHelper.searchResponse(['C001', 'C002']),
            });
          }
          if (
            typeof url === 'string' &&
            url.includes('conversations.history')
          ) {
            const channelMatch = url.match(/channel=([^&]+)/);
            const channel = channelMatch?.[1];
            if (channel === 'C001') {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: 'hello from general',
                      ts: '1700000001.000000',
                      user: 'U100',
                    },
                    {
                      text: 'another msg',
                      ts: '1700000002.000000',
                      user: 'U100',
                    },
                  ]),
              });
            }
            if (channel === 'C002') {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: 'hello from random',
                      ts: '1700000003.000000',
                      user: 'U200',
                    },
                  ]),
              });
            }
            // Channel C003 should never be fetched (not active)
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () => SlackTestHelper.historyResponse([]),
            });
          }
          if (typeof url === 'string' && url.includes('users.info')) {
            const userMatch = url.match(/user=([^&]+)/);
            const userId = userMatch?.[1];
            if (userId === 'U200') {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({
                  ok: true,
                  user: {
                    id: 'U200',
                    name: 'randomuser',
                    profile: { display_name: 'Random User' },
                  },
                }),
              });
            }
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

        stack = IntegrationHelper.createSlackStack();

        // When: run full first-launch ingestion
        const progressCalls: Array<{
          phase: string;
          channel?: string;
          channelIndex?: number;
          totalChannels?: number;
        }> = [];
        const result = await stack.ingestionService.ingest(
          (info) => {
            progressCalls.push({
              phase: info.phase,
              channel: info.channel,
              channelIndex: info.channelIndex,
              totalChannels: info.totalChannels,
            });
          },
          { skipExisting: false },
        );

        // Then: verify progress phases appear in correct order
        const phaseOrder = progressCalls.map((p) => p.phase);
        const listingIdx = phaseOrder.indexOf('listing');
        const detectingIdx = phaseOrder.indexOf('detecting');
        const fetchingIdx = phaseOrder.indexOf('fetching');
        const firstChannelIdx = phaseOrder.indexOf('channel');
        const threadsIdx = phaseOrder.indexOf('threads');
        const miningIdx = phaseOrder.indexOf('mining');

        expect(listingIdx).toBeGreaterThanOrEqual(0);
        expect(detectingIdx).toBeGreaterThan(listingIdx);
        expect(fetchingIdx).toBeGreaterThan(detectingIdx);
        expect(firstChannelIdx).toBeGreaterThan(fetchingIdx);
        expect(threadsIdx).toBeGreaterThan(firstChannelIdx);
        expect(miningIdx).toBeGreaterThan(threadsIdx);

        // Verify each 'channel' progress has defined channel, channelIndex, totalChannels
        const channelProgresses = progressCalls.filter(
          (p) => p.phase === 'channel',
        );
        for (const cp of channelProgresses) {
          expect(cp.channel).toBeDefined();
          expect(cp.channelIndex).toBeDefined();
          expect(cp.totalChannels).toBeDefined();
        }

        // Verify state file exists with cursors for the 2 active channels
        expect(existsSync(stack.statePath)).toBe(true);
        const stateRaw = readFileSync(stack.statePath, 'utf-8');
        const state: OracleState = JSON.parse(stateRaw);
        expect(state.channelCursors['C001']).toBeDefined();
        expect(state.channelCursors['C002']).toBeDefined();
        // C003 was not active, should not have a cursor
        expect(state.channelCursors['C003']).toBeUndefined();

        // Verify staging dir has 2 JSON files
        const { readdirSync } = await import('fs');
        const stagingFiles = readdirSync(stack.stagingDir).filter((f: string) =>
          f.endsWith('.json'),
        );
        expect(stagingFiles).toHaveLength(2);

        // Verify return value
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');
        expect(result.channelNames).toContain('random');
        expect(result.channelNames).not.toContain('engineering');
      }, 30000);
    });

    // FS-2: Reset and re-sync
    describe('FS-2: Reset and re-sync', () => {
      it('should clear cursors on reset and re-sync all channels with 30-day lookback', async () => {
        // Given: state file with cursors for 3 channels, lastChecked set
        const initialState = SlackTestHelper.oracleState({
          lastChecked: new Date().toISOString(),
          channelCursors: {
            C001: '1700000001.000000',
            C002: '1700000002.000000',
            C003: '1700000003.000000',
          },
          conversations: [testChannel, testChannel2, testChannel3],
          activeChannelIds: ['C001', 'C002', 'C003'],
          channelsCachedAt: new Date().toISOString(),
          activeChannelsCachedAt: new Date().toISOString(),
        });

        global.fetch = createRoutedFetch({
          'conversations.history': () =>
            SlackTestHelper.historyResponse([
              {
                text: 'fresh msg',
                ts: '1700100001.000000',
                user: 'U100',
              },
            ]),
          'search.messages': () =>
            SlackTestHelper.searchResponse(['C001', 'C002', 'C003']),
          'users.info': () => ({
            ok: true,
            user: {
              id: 'U100',
              name: 'testuser',
              profile: { display_name: 'Test User' },
            },
          }),
        }) as any;

        stack = IntegrationHelper.createSlackStack({ initialState });

        // When: call resetState
        stack.ingestionService.resetState();

        // Then: state file exists but has empty cursors and null lastChecked
        expect(existsSync(stack.statePath)).toBe(true);
        const resetStateRaw = readFileSync(stack.statePath, 'utf-8');
        const resetState: OracleState = JSON.parse(resetStateRaw);
        expect(resetState.lastChecked).toBeNull();
        expect(resetState.channelCursors).toEqual({});
        // conversations cache may be preserved
        expect(resetState.conversations).toBeDefined();

        // Set up fresh fetch mocks to track the oldest param
        const oldestParams: string[] = [];
        global.fetch = jest.fn((url: string) => {
          if (
            typeof url === 'string' &&
            url.includes('conversations.history')
          ) {
            const oldestMatch = url.match(/oldest=([^&]+)/);
            if (oldestMatch) oldestParams.push(oldestMatch[1]);
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () =>
                SlackTestHelper.historyResponse([
                  {
                    text: 'fresh msg',
                    ts: '1700100001.000000',
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
              json: async () =>
                SlackTestHelper.searchResponse(['C001', 'C002', 'C003']),
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

        // When: run ingestion again after reset
        const result = await stack.ingestionService.ingest();

        // Then: all channels fetched fresh with 30-day lookback
        // Phase 1 calls use defaultCursor (~30 days ago). Phase 2 thread bootstrap
        // also calls conversations.history with a different oldest. Filter to only
        // check Phase 1 calls (those within range of the expected 30-day lookback).
        const INITIAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
        const expectedOldest = (Date.now() - INITIAL_LOOKBACK_MS) / 1000;
        const phase1OldestParams = oldestParams.filter((oldest) => {
          const diff = Math.abs(parseFloat(oldest) - expectedOldest);
          return diff < 60; // within 60 seconds = Phase 1 default cursor
        });
        // At least 3 Phase 1 calls should have used the 30-day lookback
        expect(phase1OldestParams.length).toBeGreaterThanOrEqual(3);
        // None of the Phase 1 calls reused old cursors (e.g. 1700000001)
        for (const oldest of phase1OldestParams) {
          const oldestNum = parseFloat(oldest);
          expect(Math.abs(oldestNum - expectedOldest)).toBeLessThan(60);
        }

        // New cursors written to state
        const newStateRaw = readFileSync(stack.statePath, 'utf-8');
        const newState: OracleState = JSON.parse(newStateRaw);
        expect(newState.channelCursors['C001']).toBeDefined();
        expect(newState.channelCursors['C002']).toBeDefined();
        expect(newState.channelCursors['C003']).toBeDefined();
        expect(newState.lastChecked).not.toBeNull();

        expect(result.messagesStored).toBeGreaterThan(0);
      }, 30000);
    });

    // FS-3: Manual sync progress integrity
    describe('FS-3: Manual sync progress integrity', () => {
      it('should report correct progress phases and channel indices during pre-filtered manual sync', async () => {
        // Given: state with lastChecked set (triggers pre-filter), 3 channels with cursors
        // activeChannelIds cached so active detection search doesn't run
        const initialState = SlackTestHelper.oracleState({
          lastChecked: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          channelCursors: {
            C001: '1700000001.000000',
            C002: '1700000002.000000',
            C003: '1700000003.000000',
          },
          conversations: [testChannel, testChannel2, testChannel3],
          activeChannelIds: ['C001', 'C002', 'C003'],
          channelsCachedAt: new Date().toISOString(),
          activeChannelsCachedAt: new Date().toISOString(),
        });

        // Mock search.messages for pre-filter: return only C001 and C002 as changed
        // (NOT C003 — it's unchanged). The pre-filter query does NOT include from:me.
        global.fetch = jest.fn((url: string) => {
          if (typeof url === 'string' && url.includes('search.messages')) {
            // Pre-filter: no from:me in query, returns C001 and C002
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () =>
                SlackTestHelper.searchResponse(['C001', 'C002']),
            });
          }
          if (
            typeof url === 'string' &&
            url.includes('conversations.history')
          ) {
            const channelMatch = url.match(/channel=([^&]+)/);
            const channel = channelMatch?.[1];
            if (channel === 'C001') {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: 'new msg general',
                      ts: '1700100001.000000',
                      user: 'U100',
                    },
                  ]),
              });
            }
            if (channel === 'C002') {
              return Promise.resolve({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () =>
                  SlackTestHelper.historyResponse([
                    {
                      text: 'new msg random',
                      ts: '1700100002.000000',
                      user: 'U100',
                    },
                  ]),
              });
            }
            // C003 should not be fetched (filtered out by pre-filter)
            return Promise.resolve({
              status: 200,
              ok: true,
              headers: new Headers(),
              json: async () => SlackTestHelper.historyResponse([]),
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
        // Leave oracleEventService as null to avoid needing to mock it
        stack.ingestionService.oracleEventService = null;

        // When: run triggerIngest with progress tracking
        const progressCalls: Array<{
          phase: string;
          channel?: string;
          channelIndex?: number;
          totalChannels?: number;
        }> = [];
        const result = await stack.ingestionService.triggerIngest((info) => {
          progressCalls.push({
            phase: info.phase,
            channel: info.channel,
            channelIndex: info.channelIndex,
            totalChannels: info.totalChannels,
          });
        });

        // Then: verify strict phase ordering
        const phaseOrder = progressCalls.map((p) => p.phase);
        const prefilterIdx = phaseOrder.indexOf('prefilter');
        const fetchingIdx = phaseOrder.indexOf('fetching');
        const firstChannelIdx = phaseOrder.indexOf('channel');
        const threadsIdx = phaseOrder.indexOf('threads');
        const miningIdx = phaseOrder.indexOf('mining');

        expect(prefilterIdx).toBeGreaterThanOrEqual(0);
        expect(fetchingIdx).toBeGreaterThan(prefilterIdx);
        expect(firstChannelIdx).toBeGreaterThan(fetchingIdx);
        expect(threadsIdx).toBeGreaterThan(firstChannelIdx);
        expect(miningIdx).toBeGreaterThanOrEqual(0);
        expect(miningIdx).toBeGreaterThan(threadsIdx);

        // Verify: no progress call has undefined channel or channelIndex when phase is 'channel'
        const channelProgresses = progressCalls.filter(
          (p) => p.phase === 'channel',
        );
        for (const cp of channelProgresses) {
          expect(cp.channel).toBeDefined();
          expect(cp.channelIndex).toBeDefined();
        }

        // Verify: channel indices are 1/2 and 2/2 (NOT 1/3, 2/3)
        const channelIndices = channelProgresses.map(
          (p) => `${p.channelIndex}/${p.totalChannels}`,
        );
        expect(channelIndices).toContain('1/2');
        expect(channelIndices).toContain('2/2');
        expect(channelIndices).not.toContain('1/3');
        expect(channelIndices).not.toContain('2/3');
        expect(channelIndices).not.toContain('3/3');

        // Verify: 'skipped' phase does NOT fire
        const skippedPhases = progressCalls.filter(
          (p) => p.phase === 'skipped',
        );
        expect(skippedPhases).toHaveLength(0);

        // Verify: result is correct
        expect(result.messagesStored).toBeGreaterThan(0);
        expect(result.channelNames).toContain('general');
        expect(result.channelNames).toContain('random');
        expect(result.channelNames).not.toContain('engineering');
      }, 30000);
    });
  });
});
