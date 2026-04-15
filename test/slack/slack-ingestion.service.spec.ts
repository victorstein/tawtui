/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { SlackIngestionService } from '../../src/modules/slack/slack-ingestion.service';
import type { SlackService } from '../../src/modules/slack/slack.service';
import type { MempalaceService } from '../../src/modules/slack/mempalace.service';
import type { SlackConversation } from '../../src/modules/slack/slack.types';
import { SlackTestHelper } from '../helpers/slack-test.helper';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockSlackService(): jest.Mocked<SlackService> {
  return {
    getConversations: jest.fn().mockResolvedValue([]),
    getActiveChannelIds: jest.fn().mockResolvedValue(new Set<string>()),
    getMentionedChannelIds: jest.fn().mockResolvedValue(new Set<string>()),
    getChangedChannelIds: jest.fn().mockResolvedValue(new Set<string>()),
    getMessagesSince: jest.fn().mockResolvedValue([]),
    getThreadReplies: jest.fn().mockResolvedValue([]),
    getFullThread: jest.fn().mockResolvedValue([]),
    buildMessage: jest.fn(),
    resolveUserName: jest.fn().mockResolvedValue('TestUser'),
    hydrateUserCache: jest.fn(),
    exportUserCache: jest.fn().mockReturnValue({}),
    onWait: null,
    shouldAbort: null,
  } as unknown as jest.Mocked<SlackService>;
}

function createMockMempalaceService(): jest.Mocked<MempalaceService> {
  return {
    mine: jest.fn().mockResolvedValue(undefined),
    isInstalled: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<MempalaceService>;
}

describe('SlackIngestionService', () => {
  let service: SlackIngestionService;
  let mockSlack: jest.Mocked<SlackService>;
  let mockMempalace: jest.Mocked<MempalaceService>;
  let tmpDir: string;

  beforeEach(() => {
    mockSlack = createMockSlackService();
    mockMempalace = createMockMempalaceService();
    service = new SlackIngestionService(mockSlack, mockMempalace);
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-ingest-test-'));
    (service as any).stagingDir = join(tmpDir, 'inbox');
    (service as any).statePath = join(tmpDir, 'oracle-state.json');
    jest.clearAllMocks();
    // Reset default mock return values after clearAllMocks
    mockSlack.getActiveChannelIds.mockResolvedValue(new Set<string>());
    mockSlack.getMentionedChannelIds.mockResolvedValue(new Set<string>());
    mockSlack.exportUserCache.mockReturnValue({});
    mockSlack.getMessagesSince.mockResolvedValue([]);
    mockSlack.getThreadReplies.mockResolvedValue([]);
    mockSlack.getFullThread.mockResolvedValue([]);
    mockSlack.resolveUserName.mockResolvedValue('TestUser');
    mockSlack.getChangedChannelIds.mockResolvedValue(new Set<string>());
    mockMempalace.mine.mockResolvedValue(undefined);
  });

  afterEach(() => {
    service.stopPolling();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // State Management
  // ----------------------------------------------------------------
  describe('State Management', () => {
    describe('Behavior', () => {
      it('should load default state when no file exists', () => {
        const hasSync = service.hasCompletedSync;
        expect(hasSync).toBe(false);
      });

      it('should save state to disk and persist across loads', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000100.000000', userId: 'U1', text: 'hi' },
        ]);

        await service.ingest();

        const statePath = (service as any).statePath;
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.lastChecked).toBeTruthy();
        expect(state.channelCursors['C1']).toBe('1700000100.000000');
      });

      it('should handle corrupted state file gracefully', () => {
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });
        writeFileSync(statePath, '{invalid json!!!', 'utf-8');

        // Should not throw — falls back to default state
        expect(service.hasCompletedSync).toBe(false);
      });
    });
  });

  // ----------------------------------------------------------------
  // ingest — Phase 1 (List & Filter)
  // ----------------------------------------------------------------
  describe('ingest — Phase 1 (List & Filter)', () => {
    describe('Behavior', () => {
      it('should fetch conversations when cache is empty', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        expect(mockSlack.getConversations).toHaveBeenCalledTimes(1);
      });

      it('should use cached conversations when available', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        expect(mockSlack.getConversations).not.toHaveBeenCalled();
      });

      it('should detect active channels via getActiveChannelIds', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        expect(mockSlack.getActiveChannelIds).toHaveBeenCalledTimes(1);
      });

      it('should filter to only active channels (not previously synced)', async () => {
        const activeConv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'active',
        });
        const syncedConv = SlackTestHelper.conversation({
          id: 'C2',
          name: 'synced',
        });
        const inactiveConv = SlackTestHelper.conversation({
          id: 'C3',
          name: 'inactive',
        });

        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              channelCursors: { C2: '1700000100.000000' },
              conversations: [activeConv, syncedConv, inactiveConv],
              channelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        // Should fetch messages for C1 (active) only — C2 has a cursor but is not active
        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (args: unknown[]) => args[0],
        );
        expect(fetchedChannelIds).toContain('C1');
        expect(fetchedChannelIds).not.toContain('C2');
        expect(fetchedChannelIds).not.toContain('C3');
      });
    });

    describe('Edge Cases', () => {
      it('should force-include self-DM channel when slackUserId is set', async () => {
        const selfDm = SlackTestHelper.conversation({
          id: 'D999',
          name: 'U_SELF',
          isDm: true,
          isPrivate: true,
        });
        const otherConv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });

        mockSlack.getConversations.mockResolvedValue([selfDm, otherConv]);
        // Self-DM is NOT in active channels (search.messages doesn't index it)
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        service.slackUserId = 'U_SELF';

        await service.ingest();

        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (args: unknown[]) => args[0],
        );
        expect(fetchedChannelIds).toContain('D999');
      });

      it('should respect active channel cache 1hr TTL', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        // Cached 30 minutes ago — should use cache
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date(
                Date.now() - 30 * 60 * 1000,
              ).toISOString(),
            }),
          ),
          'utf-8',
        );

        await service.ingest();

        expect(mockSlack.getActiveChannelIds).not.toHaveBeenCalled();
        expect(mockSlack.getMentionedChannelIds).not.toHaveBeenCalled();
      });

      it('should refresh active channels when cache is older than 1hr', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        // Cached 2 hours ago — should refresh
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date(
                Date.now() - 2 * 60 * 60 * 1000,
              ).toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMentionedChannelIds.mockResolvedValue(new Set<string>());

        await service.ingest();

        expect(mockSlack.getActiveChannelIds).toHaveBeenCalledTimes(1);
        expect(mockSlack.getMentionedChannelIds).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ----------------------------------------------------------------
  // Channel Filtering
  // ----------------------------------------------------------------
  describe('Channel Filtering', () => {
    describe('Behavior', () => {
      it('should include channels where user was mentioned but not active', async () => {
        const mentionedChannel = SlackTestHelper.conversation({
          id: 'C-MENTIONED',
          name: 'mentioned-only',
        });
        const activeChannel = SlackTestHelper.conversation({
          id: 'C-ACTIVE',
          name: 'active-channel',
        });
        const inactiveChannel = SlackTestHelper.conversation({
          id: 'C-INACTIVE',
          name: 'inactive-channel',
        });

        mockSlack.getConversations.mockResolvedValue([
          mentionedChannel,
          activeChannel,
          inactiveChannel,
        ]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C-ACTIVE']));
        mockSlack.getMentionedChannelIds.mockResolvedValue(
          new Set(['C-MENTIONED']),
        );

        // Provide messages for active/mentioned channels so we can verify which were fetched
        mockSlack.getMessagesSince.mockResolvedValue([]);

        await (service as any).ingest();

        // getMessagesSince should be called for active + mentioned, but NOT inactive
        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (call: any[]) => call[0],
        );
        expect(fetchedChannelIds).toContain('C-ACTIVE');
        expect(fetchedChannelIds).toContain('C-MENTIONED');
        expect(fetchedChannelIds).not.toContain('C-INACTIVE');
      });

      it('should NOT include channels that only have a stale cursor', async () => {
        const activeChannel = SlackTestHelper.conversation({
          id: 'C-ACTIVE',
          name: 'active-channel',
        });
        const staleChannel = SlackTestHelper.conversation({
          id: 'C-STALE',
          name: 'stale-channel',
        });

        mockSlack.getConversations.mockResolvedValue([
          activeChannel,
          staleChannel,
        ]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C-ACTIVE']));
        mockSlack.getMentionedChannelIds.mockResolvedValue(new Set());

        // Seed state with a cursor for the stale channel
        const statePath = (service as any).statePath;
        writeFileSync(
          statePath,
          JSON.stringify({
            lastChecked: null,
            channelCursors: { 'C-STALE': '1700000000.000000' },
          }),
        );

        mockSlack.getMessagesSince.mockResolvedValue([]);
        await (service as any).ingest();

        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (call: any[]) => call[0],
        );
        expect(fetchedChannelIds).not.toContain('C-STALE');
      });
    });
  });

  // ----------------------------------------------------------------
  // ingest — Phase 2 (Pre-filter)
  // ----------------------------------------------------------------
  describe('ingest — Phase 2 (Pre-filter)', () => {
    describe('Behavior', () => {
      it('should skip pre-filter on first sync (no lastChecked)', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        expect(mockSlack.getChangedChannelIds).not.toHaveBeenCalled();
      });

      it('should call getChangedChannelIds on subsequent syncs', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        const lastChecked = new Date(
          Date.now() - 2 * 60 * 60 * 1000,
        ).toISOString();
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              lastChecked,
              channelCursors: { C1: '1700000100.000000' },
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getChangedChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        expect(mockSlack.getChangedChannelIds).toHaveBeenCalledTimes(1);
        const callArgs = mockSlack.getChangedChannelIds.mock.calls[0];
        // First arg should be a date string (YYYY-MM-DD)
        expect(callArgs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should fire onProgress with phase prefilter and channelsSoFar', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              lastChecked: new Date(
                Date.now() - 2 * 60 * 60 * 1000,
              ).toISOString(),
              channelCursors: { C1: '1700000100.000000' },
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getChangedChannelIds.mockResolvedValue(new Set(['C1']));

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const prefilterCalls = progressCalls.filter(
          (p) => p.phase === 'prefilter',
        );
        expect(prefilterCalls.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Error Handling', () => {
      it('should fall back to all channels on search failure', async () => {
        const conv1 = SlackTestHelper.conversation({
          id: 'C1',
          name: 'channel-a',
        });
        const conv2 = SlackTestHelper.conversation({
          id: 'C2',
          name: 'channel-b',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              lastChecked: new Date(
                Date.now() - 2 * 60 * 60 * 1000,
              ).toISOString(),
              channelCursors: {
                C1: '1700000100.000000',
                C2: '1700000100.000000',
              },
              conversations: [conv1, conv2],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1', 'C2'],
              activeChannelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        mockSlack.getChangedChannelIds.mockRejectedValue(
          new Error('search failed'),
        );

        await service.ingest();

        // Both channels should be fetched since search fallback means no filtering
        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (args: unknown[]) => args[0],
        );
        expect(fetchedChannelIds).toContain('C1');
        expect(fetchedChannelIds).toContain('C2');
      });
    });

    describe('Edge Cases', () => {
      it('should force-include self-DM in changed channels', async () => {
        const selfDm = SlackTestHelper.conversation({
          id: 'D999',
          name: 'U_SELF',
          isDm: true,
          isPrivate: true,
        });
        const otherConv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              lastChecked: new Date(
                Date.now() - 2 * 60 * 60 * 1000,
              ).toISOString(),
              channelCursors: {
                D999: '1700000100.000000',
                C1: '1700000100.000000',
              },
              conversations: [selfDm, otherConv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['D999', 'C1'],
              activeChannelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        service.slackUserId = 'U_SELF';
        // Pre-populate selfDmChannelId by simulating prior detection
        (service as any).selfDmChannelId = 'D999';

        // getChangedChannelIds returns only C1 (not the self-DM)
        mockSlack.getChangedChannelIds.mockResolvedValue(new Set(['C1']));

        await service.ingest();

        // Self-DM should still be fetched despite not being in changedChannelIds
        const fetchedChannelIds = mockSlack.getMessagesSince.mock.calls.map(
          (args: unknown[]) => args[0],
        );
        expect(fetchedChannelIds).toContain('D999');
      });
    });
  });

  // ----------------------------------------------------------------
  // ingest — Phase 3 (Fetch Messages)
  // ----------------------------------------------------------------
  describe('ingest — Phase 3 (Fetch Messages)', () => {
    describe('Behavior', () => {
      it('should fetch messages per channel and write staging JSON files', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'Ship it on Friday' },
        ]);
        mockSlack.resolveUserName.mockResolvedValue('Alfonso');

        await service.ingest();

        const stagingDir = (service as any).stagingDir;
        const files = readdirSync(stagingDir);
        expect(files.length).toBe(1);
        expect(files[0]).toContain('general');
        expect(files[0]).toMatch(/\.json$/);

        const content = JSON.parse(
          readFileSync(join(stagingDir, files[0]), 'utf-8'),
        );
        expect(content).toBeInstanceOf(Array);
        expect(content[0]).toMatchObject({
          type: 'message',
          user: 'Alfonso',
          text: 'Alfonso: Ship it on Friday',
        });
      });

      it('should advance cursor to last top-level message ts (not thread reply ts)', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000100.000000', userId: 'U1', text: 'top level' },
          { ts: '1700000200.000000', userId: 'U2', text: 'parent' },
          {
            ts: '1700000250.000000',
            userId: 'U3',
            text: 'reply',
            threadTs: '1700000200.000000',
          },
          { ts: '1700000300.000000', userId: 'U4', text: 'last top level' },
        ]);

        await service.ingest();

        const statePath = (service as any).statePath;
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.channelCursors['C1']).toBe('1700000300.000000');
      });

      it('should fire onProgress with phase channel including channel, channelIndex, totalChannels, page, messageCount', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const channelCalls = progressCalls.filter((p) => p.phase === 'channel');
        expect(channelCalls.length).toBeGreaterThanOrEqual(1);

        // Check the first channel call has required fields
        const startCall = channelCalls[0];
        expect(startCall.channel).toBe('general');
        expect(startCall.channelIndex).toBe(1);
        expect(startCall.totalChannels).toBe(1);

        // Check there's a completion call with messageCount
        const completionCall = channelCalls.find(
          (c) => c.messageCount !== undefined,
        );
        expect(completionCall).toBeDefined();
        expect(completionCall!.messageCount).toBe(1);
      });
    });

    describe('Error Handling', () => {
      it('should skip channel on API error and continue others', async () => {
        const conv1 = SlackTestHelper.conversation({
          id: 'C1',
          name: 'fails',
        });
        const conv2 = SlackTestHelper.conversation({
          id: 'C2',
          name: 'works',
        });
        mockSlack.getConversations.mockResolvedValue([conv1, conv2]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1', 'C2']));
        mockSlack.getMessagesSince
          .mockRejectedValueOnce(new Error('channel_not_found'))
          .mockResolvedValueOnce([
            { ts: '1700000200.000000', userId: 'U1', text: 'success' },
          ]);

        const result = await service.ingest();

        expect(result.messagesStored).toBe(1);
        expect(result.channelNames).toContain('works');
        expect(result.channelNames).not.toContain('fails');
      });
    });

    describe('Edge Cases', () => {
      it('should produce no staging files for empty channels', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([]);

        await service.ingest();

        expect(mockMempalace.mine).not.toHaveBeenCalled();
      });

      it('should slugify DM channel names with dm- prefix', async () => {
        const dmConv = SlackTestHelper.conversation({
          id: 'D456',
          name: 'victor',
          isDm: true,
          isPrivate: true,
        });
        mockSlack.getConversations.mockResolvedValue([dmConv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['D456']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U456', text: 'Review my PR?' },
        ]);
        mockSlack.resolveUserName.mockResolvedValue('Victor');

        await service.ingest();

        const stagingDir = (service as any).stagingDir;
        const files = readdirSync(stagingDir);
        expect(files[0]).toContain('dm-victor');
      });

      it('should use 30-day lookback cursor when no state exists', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        const beforeCall = Date.now();
        await service.ingest();
        const afterCall = Date.now();

        expect(mockSlack.getMessagesSince).toHaveBeenCalledTimes(1);
        const callArgs = mockSlack.getMessagesSince.mock.calls[0];
        expect(callArgs[0]).toBe('C1');

        const cursorValue = parseFloat(callArgs[1]);
        const expectedLow = (beforeCall - 30 * 24 * 60 * 60 * 1000) / 1000;
        const expectedHigh = (afterCall - 30 * 24 * 60 * 60 * 1000) / 1000;
        expect(cursorValue).toBeGreaterThanOrEqual(expectedLow - 1);
        expect(cursorValue).toBeLessThanOrEqual(expectedHigh + 1);
      });
    });
  });

  // ----------------------------------------------------------------
  // ingest — Phase 4 (Thread Sync)
  // ----------------------------------------------------------------
  describe('ingest — Phase 4 (Thread Sync)', () => {
    describe('Behavior', () => {
      it('should fire onProgress with phase threads before thread loop', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const threadPhases = progressCalls.filter((p) => p.phase === 'threads');
        expect(threadPhases.length).toBeGreaterThanOrEqual(1);
      });

      it('should bootstrap tracked threads on first sync of a channel', async () => {
        const now = Math.floor(Date.now() / 1000);
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        const stagingDir = (service as any).stagingDir;
        mkdirSync(stagingDir, { recursive: true });

        // Channel has a cursor but no tracked threads — triggers bootstrap
        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              channelCursors: { C1: `${now - 200}.000000` },
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date().toISOString(),
            }),
          ),
          'utf-8',
        );

        // Phase 1: no new messages
        mockSlack.getMessagesSince
          .mockResolvedValueOnce([]) // Phase 1 fetch
          .mockResolvedValueOnce([
            // Phase 2 bootstrap backfill
            {
              ts: `${now - 500}.000000`,
              userId: 'U1',
              text: 'parent',
              replyCount: 3,
            },
            { ts: `${now - 400}.000000`, userId: 'U2', text: 'normal msg' },
          ]);
        mockSlack.getThreadReplies.mockResolvedValue([]);

        await service.ingest();

        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.trackedThreads).toBeDefined();
        expect(state.trackedThreads['C1']).toHaveLength(1);
        expect(state.trackedThreads['C1'][0].threadTs).toBe(
          `${now - 500}.000000`,
        );
      });

      it('should prune threads older than 30 days', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const thirtyOneDaysAgo = String(
          (Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000,
        );
        const oneDayAgo = String((Date.now() - 1 * 24 * 60 * 60 * 1000) / 1000);

        const statePath = (service as any).statePath;
        const stagingDir = (service as any).stagingDir;
        mkdirSync(stagingDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              channelCursors: { C1: '1700000200.000000' },
              conversations: [conv],
              activeChannelIds: ['C1'],
              channelsCachedAt: new Date().toISOString(),
              activeChannelsCachedAt: new Date().toISOString(),
              trackedThreads: {
                C1: [
                  {
                    threadTs: thirtyOneDaysAgo,
                    lastReplyTs: thirtyOneDaysAgo,
                  },
                  { threadTs: oneDayAgo, lastReplyTs: oneDayAgo },
                ],
              },
            }),
          ),
          'utf-8',
        );

        mockSlack.getThreadReplies.mockResolvedValue([]);

        await service.ingest();

        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.trackedThreads['C1']).toHaveLength(1);
        expect(state.trackedThreads['C1'][0].threadTs).toBe(oneDayAgo);
      });

      it('should detect new thread replies and write thread staging files', async () => {
        const now = Math.floor(Date.now() / 1000);
        const parentTs = `${now - 300}.000000`;
        const reply1Ts = `${now - 250}.000000`;
        const reply2Ts = `${now - 240}.000000`;
        const newReplyTs = `${now - 100}.000000`;
        const cursorTs = `${now - 200}.000000`;

        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        const stagingDir = (service as any).stagingDir;
        mkdirSync(stagingDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              channelCursors: { C1: cursorTs },
              conversations: [conv],
              activeChannelIds: ['C1'],
              channelsCachedAt: new Date().toISOString(),
              activeChannelsCachedAt: new Date().toISOString(),
              trackedThreads: {
                C1: [{ threadTs: parentTs, lastReplyTs: reply2Ts }],
              },
            }),
          ),
          'utf-8',
        );

        mockSlack.getMessagesSince.mockResolvedValue([]);
        mockSlack.getThreadReplies.mockResolvedValue([
          { ts: reply1Ts, userId: 'U2', text: 'old reply' },
          { ts: reply2Ts, userId: 'U3', text: 'old reply 2' },
          { ts: newReplyTs, userId: 'U4', text: 'new reply!' },
        ]);
        mockSlack.getFullThread.mockResolvedValue([
          { ts: parentTs, userId: 'U1', text: 'parent message' },
          { ts: reply1Ts, userId: 'U2', text: 'old reply' },
          { ts: reply2Ts, userId: 'U3', text: 'old reply 2' },
          { ts: newReplyTs, userId: 'U4', text: 'new reply!' },
        ]);

        const result = await service.ingest();

        expect(result.messagesStored).toBe(1);
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.trackedThreads['C1'][0].lastReplyTs).toBe(newReplyTs);

        const files = readdirSync(stagingDir);
        const threadFile = files.find((f) => f.includes('thread-'));
        expect(threadFile).toBeDefined();
      });

      it('should track thread parents discovered in Phase 1', async () => {
        const now = Math.floor(Date.now() / 1000);
        const parentTs = `${now - 300}.000000`;
        const reply1Ts = `${now - 250}.000000`;
        const reply2Ts = `${now - 240}.000000`;
        const otherTs = `${now - 200}.000000`;

        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          {
            ts: parentTs,
            userId: 'U1',
            text: 'parent',
            replyCount: 2,
          },
          {
            ts: reply1Ts,
            userId: 'U2',
            text: 'reply 1',
            threadTs: parentTs,
          },
          {
            ts: reply2Ts,
            userId: 'U3',
            text: 'reply 2',
            threadTs: parentTs,
          },
          { ts: otherTs, userId: 'U4', text: 'no thread' },
        ]);

        await service.ingest();

        const statePath = (service as any).statePath;
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.trackedThreads).toBeDefined();
        expect(state.trackedThreads['C1']).toHaveLength(1);
        expect(state.trackedThreads['C1'][0].threadTs).toBe(parentTs);
        expect(state.trackedThreads['C1'][0].lastReplyTs).toBe(reply2Ts);
      });
    });
  });

  // ----------------------------------------------------------------
  // ingest — Phase 5 (Mine)
  // ----------------------------------------------------------------
  describe('ingest — Phase 5 (Mine)', () => {
    describe('Behavior', () => {
      it('should call mempalace mine when filesWritten > 0', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        await service.ingest();

        const stagingDir = (service as any).stagingDir;
        expect(mockMempalace.mine).toHaveBeenCalledWith(stagingDir, 'slack');
      });

      it('should skip mine when no files written', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([]);

        await service.ingest();

        expect(mockMempalace.mine).not.toHaveBeenCalled();
      });

      it('should fire onProgress with phase mining', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const miningCalls = progressCalls.filter((p) => p.phase === 'mining');
        expect(miningCalls.length).toBe(1);
      });
    });
  });

  // ----------------------------------------------------------------
  // Progress Callbacks
  // ----------------------------------------------------------------
  describe('Progress Callbacks', () => {
    describe('Behavior', () => {
      it('should include channel name, channelIndex, totalChannels in phase channel (not undefined)', async () => {
        const conv1 = SlackTestHelper.conversation({
          id: 'C1',
          name: 'alpha',
        });
        const conv2 = SlackTestHelper.conversation({
          id: 'C2',
          name: 'beta',
        });
        mockSlack.getConversations.mockResolvedValue([conv1, conv2]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1', 'C2']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const channelCalls = progressCalls.filter((p) => p.phase === 'channel');

        for (const call of channelCalls) {
          expect(call.channel).toBeDefined();
          expect(call.channelIndex).toBeDefined();
          expect(call.totalChannels).toBeDefined();
          expect(typeof call.channel).toBe('string');
          expect(typeof call.channelIndex).toBe('number');
          expect(typeof call.totalChannels).toBe('number');
        }
      });

      it('should include page number during fetch and messageCount after completion', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockImplementation(
          async (_channelId, _cursor, onPageProgress) => {
            // Simulate page progress callback
            onPageProgress?.({ messagesSoFar: 5, page: 1 });
            onPageProgress?.({ messagesSoFar: 10, page: 2 });
            return [
              { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
              { ts: '1700000201.000000', userId: 'U2', text: 'world' },
            ];
          },
        );

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const channelCalls = progressCalls.filter((p) => p.phase === 'channel');

        // Should have page-progress calls with page number
        const pageCalls = channelCalls.filter((c) => c.page !== undefined);
        expect(pageCalls.length).toBeGreaterThanOrEqual(1);
        expect(pageCalls[0].page).toBe(1);

        // The final channel call is the completion with actual messageCount
        const lastChannelCall = channelCalls[channelCalls.length - 1];
        expect(lastChannelCall.messageCount).toBe(2);
      });

      it('should fire phase threads between Phase 1 and Phase 2', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        const progressCalls: Array<Record<string, unknown>> = [];
        await service.ingest((info) => progressCalls.push(info));

        const phases = progressCalls.map((p) => p.phase);

        // threads phase should come after channel phases
        const lastChannelIdx = phases.lastIndexOf('channel');
        const firstThreadsIdx = phases.indexOf('threads');
        expect(firstThreadsIdx).toBeGreaterThan(lastChannelIdx);
      });
    });
  });

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------
  describe('Lifecycle', () => {
    describe('hasCompletedSync', () => {
      describe('Behavior', () => {
        it('should return true when lastChecked is set', () => {
          const statePath = (service as any).statePath;
          mkdirSync(tmpDir, { recursive: true });
          writeFileSync(
            statePath,
            JSON.stringify(
              SlackTestHelper.oracleState({
                lastChecked: new Date().toISOString(),
              }),
            ),
            'utf-8',
          );

          expect(service.hasCompletedSync).toBe(true);
        });

        it('should return false after resetState()', () => {
          const statePath = (service as any).statePath;
          mkdirSync(tmpDir, { recursive: true });
          writeFileSync(
            statePath,
            JSON.stringify(
              SlackTestHelper.oracleState({
                lastChecked: new Date().toISOString(),
              }),
            ),
            'utf-8',
          );

          expect(service.hasCompletedSync).toBe(true);
          service.resetState();
          expect(service.hasCompletedSync).toBe(false);
        });
      });
    });

    describe('onFirstIngestComplete', () => {
      describe('Behavior', () => {
        it('should fire once with result then clear itself', async () => {
          const conv = SlackTestHelper.conversation({
            id: 'C1',
            name: 'general',
          });
          mockSlack.getConversations.mockResolvedValue([conv]);
          mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
          mockSlack.getMessagesSince.mockResolvedValue([
            { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
          ]);

          const firstIngestCallback = jest.fn();
          service.onFirstIngestComplete = firstIngestCallback;

          // Call safeIngest via (service as any) to trigger the callback path
          await (service as any).safeIngest();

          expect(firstIngestCallback).toHaveBeenCalledTimes(1);
          expect(service.onFirstIngestComplete).toBeNull();
        });
      });
    });

    describe('safeIngest', () => {
      describe('Behavior', () => {
        it('should return early when _ingesting is true (poll during manual sync)', async () => {
          const conv = SlackTestHelper.conversation({
            id: 'C1',
            name: 'general',
          });
          mockSlack.getConversations.mockResolvedValue([conv]);
          mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
          mockSlack.getMessagesSince.mockResolvedValue([]);

          // Simulate _ingesting is true
          (service as any)._ingesting = true;

          await (service as any).safeIngest();

          // Should not have called any Slack APIs since ingest() returns early
          expect(mockSlack.getConversations).not.toHaveBeenCalled();
        });
      });
    });

    describe('startPolling / stopPolling', () => {
      describe('Behavior', () => {
        it('should manage timer via startPolling and stopPolling', () => {
          jest.useFakeTimers();
          try {
            expect(service.isPolling()).toBe(false);

            service.startPolling(60000);
            expect(service.isPolling()).toBe(true);

            service.stopPolling();
            expect(service.isPolling()).toBe(false);
          } finally {
            jest.useRealTimers();
          }
        });

        it('should not start a second timer if already polling', () => {
          jest.useFakeTimers();
          try {
            service.startPolling(60000);
            const timer1 = (service as any).timer;

            service.startPolling(60000);
            const timer2 = (service as any).timer;

            expect(timer1).toBe(timer2);
          } finally {
            service.stopPolling();
            jest.useRealTimers();
          }
        });
      });
    });
  });

  // ----------------------------------------------------------------
  // Abort
  // ----------------------------------------------------------------
  describe('Abort', () => {
    describe('Behavior', () => {
      it('should increment generation and stop in-flight work', () => {
        const genBefore = (service as any)._generation;
        service.abort();
        const genAfter = (service as any)._generation;

        expect(genAfter).toBe(genBefore + 1);
        expect(service.ingesting).toBe(false);
      });

      it('should return empty result when aborted mid-flight', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockImplementation(async () => {
          // Simulate abort during getConversations
          service.abort();
          return [conv];
        });

        const result = await service.ingest();

        expect(result.messagesStored).toBe(0);
        expect(result.channelNames).toEqual([]);
      });
    });
  });

  // ----------------------------------------------------------------
  // resetState
  // ----------------------------------------------------------------
  describe('resetState', () => {
    describe('Behavior', () => {
      it('should remove staging dir and clear cursors but preserve channel caches', () => {
        const stagingDir: string = (service as any).stagingDir;
        const statePath: string = (service as any).statePath;

        mkdirSync(stagingDir, { recursive: true });
        writeFileSync(join(stagingDir, 'test-file.json'), '[]', 'utf-8');

        const conversations: SlackConversation[] = [
          { id: 'C1', name: 'general', isDm: false, isPrivate: false },
        ];
        const activeChannelIds = ['C1'];
        const channelsCachedAt = '2026-01-01T00:00:00.000Z';
        writeFileSync(
          statePath,
          JSON.stringify({
            lastChecked: '2026-01-01',
            channelCursors: { C1: '1700000300.000000' },
            conversations,
            activeChannelIds,
            channelsCachedAt,
          }),
          'utf-8',
        );

        service.resetState();

        expect(existsSync(stagingDir)).toBe(false);
        expect(existsSync(statePath)).toBe(true);
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.lastChecked).toBeNull();
        expect(state.channelCursors).toEqual({});
        expect(state.conversations).toEqual(conversations);
        expect(state.activeChannelIds).toEqual(activeChannelIds);
        expect(state.channelsCachedAt).toBe(channelsCachedAt);
      });

      it('should remove state file entirely when no channel caches exist', () => {
        const stagingDir: string = (service as any).stagingDir;
        const statePath: string = (service as any).statePath;

        mkdirSync(stagingDir, { recursive: true });
        writeFileSync(join(stagingDir, 'test-file.json'), '[]', 'utf-8');

        writeFileSync(
          statePath,
          JSON.stringify({ lastChecked: '2026-01-01', channelCursors: {} }),
          'utf-8',
        );

        service.resetState();

        expect(existsSync(statePath)).toBe(false);
        expect(existsSync(stagingDir)).toBe(false);
      });
    });
  });

  // ----------------------------------------------------------------
  // triggerIngest
  // ----------------------------------------------------------------
  describe('triggerIngest', () => {
    describe('Behavior', () => {
      it('should call ingest and return the result', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);

        const result = await service.triggerIngest();

        expect(result.messagesStored).toBe(1);
        expect(result.channelNames).toContain('general');
      });
    });
  });

  // ----------------------------------------------------------------
  // ingesting getter
  // ----------------------------------------------------------------
  describe('ingesting', () => {
    describe('Behavior', () => {
      it('should return false when no ingest is running', () => {
        expect(service.ingesting).toBe(false);
      });

      it('should return true during ingest and false after', async () => {
        let observedDuringIngest = false;
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockImplementation(async () => {
          observedDuringIngest = service.ingesting;
          return [conv];
        });
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([]);

        await service.ingest();

        expect(observedDuringIngest).toBe(true);
        expect(service.ingesting).toBe(false);
      });
    });
  });

  // ----------------------------------------------------------------
  // onStatusChange
  // ----------------------------------------------------------------
  describe('onStatusChange', () => {
    describe('Behavior', () => {
      it('should fire with true at start and false at end of ingest', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([]);

        const statusChanges: boolean[] = [];
        service.onStatusChange = (val) => statusChanges.push(val);

        await service.ingest();

        expect(statusChanges).toEqual([true, false]);
      });
    });
  });

  // ----------------------------------------------------------------
  // State hydration
  // ----------------------------------------------------------------
  describe('State hydration', () => {
    describe('Behavior', () => {
      it('should hydrate user name cache from persisted state', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        const statePath = (service as any).statePath;
        mkdirSync(tmpDir, { recursive: true });

        writeFileSync(
          statePath,
          JSON.stringify(
            SlackTestHelper.oracleState({
              conversations: [conv],
              channelsCachedAt: new Date().toISOString(),
              activeChannelIds: ['C1'],
              activeChannelsCachedAt: new Date().toISOString(),
              userNames: { U1: 'CachedUser' },
            }),
          ),
          'utf-8',
        );

        await service.ingest();

        expect(mockSlack.hydrateUserCache).toHaveBeenCalledWith({
          U1: 'CachedUser',
        });
      });

      it('should persist user name cache after ingestion with messages', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        mockSlack.getConversations.mockResolvedValue([conv]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([
          { ts: '1700000200.000000', userId: 'U1', text: 'hello' },
        ]);
        mockSlack.exportUserCache.mockReturnValue({ U1: 'Alfonso' });

        await service.ingest();

        const statePath = (service as any).statePath;
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(state.userNames).toEqual({ U1: 'Alfonso' });
      });
    });
  });

  // ----------------------------------------------------------------
  // Rate-limit wait feedback
  // ----------------------------------------------------------------
  describe('Rate-limit wait feedback', () => {
    describe('Behavior', () => {
      it('should set shouldAbort on slackService during ingest', async () => {
        const conv = SlackTestHelper.conversation({
          id: 'C1',
          name: 'general',
        });
        let capturedShouldAbort: (() => boolean) | null = null;
        mockSlack.getConversations.mockImplementation(async () => {
          capturedShouldAbort = mockSlack.shouldAbort as () => boolean;
          return [conv];
        });
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C1']));
        mockSlack.getMessagesSince.mockResolvedValue([]);

        await service.ingest();

        expect(capturedShouldAbort).toBeDefined();
        // After ingest, shouldAbort should be restored
        expect(mockSlack.shouldAbort).toBeNull();
      });
    });
  });

  // ----------------------------------------------------------------
  // Cursor Pruning
  // ----------------------------------------------------------------
  describe('Cursor Pruning', () => {
    describe('Behavior', () => {
      it('should remove cursors for channels not in active set after sync', async () => {
        const activeChannel = SlackTestHelper.conversation({
          id: 'C-ACTIVE',
          name: 'active',
        });
        const staleChannel = SlackTestHelper.conversation({
          id: 'C-STALE',
          name: 'stale',
        });

        mockSlack.getConversations.mockResolvedValue([
          activeChannel,
          staleChannel,
        ]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set(['C-ACTIVE']));
        mockSlack.getMentionedChannelIds.mockResolvedValue(new Set());
        mockSlack.getMessagesSince.mockResolvedValue([]);

        // Seed state with cursors for both channels
        const statePath = (service as any).statePath;
        writeFileSync(
          statePath,
          JSON.stringify({
            lastChecked: null,
            channelCursors: {
              'C-ACTIVE': '1700000000.000000',
              'C-STALE': '1700000000.000000',
            },
            trackedThreads: {
              'C-ACTIVE': [
                {
                  threadTs: '1700000000.000000',
                  lastReplyTs: '1700000000.000000',
                },
              ],
              'C-STALE': [
                {
                  threadTs: '1700000000.000000',
                  lastReplyTs: '1700000000.000000',
                },
              ],
            },
          }),
        );

        await (service as any).ingest();

        // Read final state
        const finalState = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(finalState.channelCursors).toHaveProperty('C-ACTIVE');
        expect(finalState.channelCursors).not.toHaveProperty('C-STALE');
        expect(finalState.trackedThreads).not.toHaveProperty('C-STALE');
      });

      it('should preserve self-DM cursor even if not in search results', async () => {
        const selfDm = SlackTestHelper.conversation({
          id: 'D-SELF',
          name: 'U123',
          isDm: true,
        });

        mockSlack.getConversations.mockResolvedValue([selfDm]);
        mockSlack.getActiveChannelIds.mockResolvedValue(new Set());
        mockSlack.getMentionedChannelIds.mockResolvedValue(new Set());
        mockSlack.getMessagesSince.mockResolvedValue([]);

        // Set the slackUserId so self-DM detection works
        (service as any).slackUserId = 'U123';

        const statePath = (service as any).statePath;
        writeFileSync(
          statePath,
          JSON.stringify({
            lastChecked: null,
            channelCursors: { 'D-SELF': '1700000000.000000' },
          }),
        );

        await (service as any).ingest();

        const finalState = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(finalState.channelCursors).toHaveProperty('D-SELF');
      });
    });
  });
});
