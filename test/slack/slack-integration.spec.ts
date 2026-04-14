/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import {
  IntegrationHelper,
  type SlackStack,
} from '../helpers/integration.helper';
import { SlackTestHelper } from '../helpers/slack-test.helper';
import { existsSync, readFileSync } from 'fs';
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
});
