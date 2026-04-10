/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { SlackIngestionService } from '../src/modules/slack/slack-ingestion.service';
import { SlackService } from '../src/modules/slack/slack.service';
import { MempalaceService } from '../src/modules/slack/mempalace.service';
import type { SlackConversation } from '../src/modules/slack/slack.types';
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

const mockSlackService = {
  getConversations: jest.fn(),
  getActiveChannelIds: jest.fn().mockResolvedValue(new Set<string>()),
  getMessagesSince: jest.fn(),
  getThreadReplies: jest.fn().mockResolvedValue([]),
  getFullThread: jest.fn().mockResolvedValue([]),
  buildMessage: jest.fn(),
  resolveUserName: jest.fn(),
  hydrateUserCache: jest.fn(),
  exportUserCache: jest.fn().mockReturnValue({}),
  onWait: null,
} as unknown as jest.Mocked<SlackService>;

const mockMempalaceService = {
  mine: jest.fn().mockResolvedValue(undefined),
  isInstalled: jest.fn().mockReturnValue(true),
} as unknown as jest.Mocked<MempalaceService>;

describe('SlackIngestionService', () => {
  let service: SlackIngestionService;
  let tmpDir: string;

  beforeEach(() => {
    service = new SlackIngestionService(mockSlackService, mockMempalaceService);
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-ingest-test-'));
    (service as any).stagingDir = join(tmpDir, 'inbox');
    (service as any).statePath = join(tmpDir, 'oracle-state.json');
    jest.clearAllMocks();
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set<string>());
    mockSlackService.exportUserCache.mockReturnValue({});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('ingest writes Slack JSON files and calls mempalace mine', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000200.000000', userId: 'U123', text: 'Ship it on Friday' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('Alfonso');

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

    expect(mockMempalaceService.mine).toHaveBeenCalledWith(stagingDir, 'slack');
  });

  it('ingest skips channels with no new messages', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([]);

    await service.ingest();

    expect(mockMempalaceService.mine).not.toHaveBeenCalled();
  });

  it('ingest updates state with channel cursors', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000200.000000', userId: 'U123', text: 'hello' },
      { ts: '1700000300.000000', userId: 'U456', text: 'world' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    await service.ingest();

    const statePath = (service as any).statePath;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.channelCursors['C123']).toBe('1700000300.000000');
    expect(state.lastChecked).toBeTruthy();
  });

  it('slugifies DM channel names with dm- prefix', async () => {
    const dmConversation: SlackConversation = {
      id: 'D456',
      name: 'victor',
      isDm: true,
      isPrivate: true,
    };
    mockSlackService.getConversations.mockResolvedValue([dmConversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['D456']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000200.000000', userId: 'U456', text: 'Review my PR?' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('Victor');

    await service.ingest();

    const stagingDir = (service as any).stagingDir;
    const files = readdirSync(stagingDir);
    expect(files[0]).toContain('dm-victor');
  });

  it('resetState removes staging dir and clears cursors but preserves channel caches', () => {
    const stagingDir: string = (service as any).stagingDir;
    const statePath: string = (service as any).statePath;

    // Pre-create staging directory with a dummy file
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'test-file.json'), '[]', 'utf-8');

    // Pre-create state file with conversations and activeChannelIds
    const conversations = [
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

    expect(existsSync(stagingDir)).toBe(true);
    expect(existsSync(statePath)).toBe(true);

    service.resetState();

    // Staging dir should be gone
    expect(existsSync(stagingDir)).toBe(false);

    // State file should still exist with preserved caches but cleared cursors
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.lastChecked).toBeNull();
    expect(state.channelCursors).toEqual({});
    expect(state.conversations).toEqual(conversations);
    expect(state.activeChannelIds).toEqual(activeChannelIds);
    expect(state.channelsCachedAt).toBe(channelsCachedAt);
  });

  it('cursor advances to last top-level message, not thread reply', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000100.000000', userId: 'U111', text: 'top level' },
      { ts: '1700000200.000000', userId: 'U222', text: 'parent' },
      { ts: '1700000250.000000', userId: 'U333', text: 'reply', threadTs: '1700000200.000000' },
      { ts: '1700000300.000000', userId: 'U444', text: 'last top level' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    await service.ingest();

    const statePath = (service as any).statePath;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    // Cursor should be '1700000300.000000' (last top-level), not '1700000250.000000' (reply)
    expect(state.channelCursors['C123']).toBe('1700000300.000000');
  });

  it('Phase 1 tracks thread parents in trackedThreads state', async () => {
    const now = Math.floor(Date.now() / 1000);
    const parentTs = `${now - 300}.000000`;
    const reply1Ts = `${now - 250}.000000`;
    const reply2Ts = `${now - 240}.000000`;
    const otherTs = `${now - 200}.000000`;

    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: parentTs, userId: 'U111', text: 'parent', replyCount: 2 },
      { ts: reply1Ts, userId: 'U222', text: 'reply 1', threadTs: parentTs },
      { ts: reply2Ts, userId: 'U333', text: 'reply 2', threadTs: parentTs },
      { ts: otherTs, userId: 'U444', text: 'no thread' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    await service.ingest();

    const statePath = (service as any).statePath;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.trackedThreads).toBeDefined();
    expect(state.trackedThreads['C123']).toHaveLength(1);
    expect(state.trackedThreads['C123'][0].threadTs).toBe(parentTs);
    expect(state.trackedThreads['C123'][0].lastReplyTs).toBe(reply2Ts);
  });

  it('Phase 2 fetches new replies for tracked threads', async () => {
    const now = Math.floor(Date.now() / 1000);
    const parentTs = `${now - 300}.000000`;
    const reply1Ts = `${now - 250}.000000`;
    const reply2Ts = `${now - 240}.000000`;
    const newReplyTs = `${now - 100}.000000`;
    const cursorTs = `${now - 200}.000000`;

    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    const statePath = (service as any).statePath;
    const stagingDir = (service as any).stagingDir;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        lastChecked: null,
        channelCursors: { C123: cursorTs },
        conversations: [conversation],
        activeChannelIds: ['C123'],
        trackedThreads: {
          C123: [{ threadTs: parentTs, lastReplyTs: reply2Ts }],
        },
      }),
      'utf-8',
    );

    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([]);
    mockSlackService.getThreadReplies.mockResolvedValue([
      { ts: reply1Ts, userId: 'U222', text: 'old reply' },
      { ts: reply2Ts, userId: 'U333', text: 'old reply 2' },
      { ts: newReplyTs, userId: 'U444', text: 'new reply!' },
    ]);
    mockSlackService.getFullThread.mockResolvedValue([
      { ts: parentTs, userId: 'U111', text: 'parent message' },
      { ts: reply1Ts, userId: 'U222', text: 'old reply' },
      { ts: reply2Ts, userId: 'U333', text: 'old reply 2' },
      { ts: newReplyTs, userId: 'U444', text: 'new reply!' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('User');

    const result = await service.ingest();

    expect(result.messagesStored).toBe(1);
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.trackedThreads['C123'][0].lastReplyTs).toBe(newReplyTs);

    const files = readdirSync(stagingDir);
    const threadFile = files.find((f) => f.includes('thread-'));
    expect(threadFile).toBeDefined();
  });

  it('Phase 2 prunes tracked threads older than 7 days', async () => {
    const conversation: SlackConversation = {
      id: 'C123',
      name: 'general',
      isDm: false,
      isPrivate: false,
    };
    const eightDaysAgo = String((Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000);
    const oneDayAgo = String((Date.now() - 1 * 24 * 60 * 60 * 1000) / 1000);

    const statePath = (service as any).statePath;
    const stagingDir = (service as any).stagingDir;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        lastChecked: null,
        channelCursors: { C123: '1700000200.000000' },
        conversations: [conversation],
        activeChannelIds: ['C123'],
        trackedThreads: {
          C123: [
            { threadTs: eightDaysAgo, lastReplyTs: eightDaysAgo },
            { threadTs: oneDayAgo, lastReplyTs: oneDayAgo },
          ],
        },
      }),
      'utf-8',
    );

    mockSlackService.getConversations.mockResolvedValue([conversation]);
    mockSlackService.getActiveChannelIds.mockResolvedValue(new Set(['C123']));
    mockSlackService.getMessagesSince.mockResolvedValue([]);
    mockSlackService.getThreadReplies.mockResolvedValue([]);

    await service.ingest();

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(state.trackedThreads['C123']).toHaveLength(1);
    expect(state.trackedThreads['C123'][0].threadTs).toBe(oneDayAgo);
  });

  it('resetState removes state file entirely when no channel caches exist', () => {
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
