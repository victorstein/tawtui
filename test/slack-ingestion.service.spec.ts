/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { SlackIngestionService } from '../src/modules/slack/slack-ingestion.service';
import { SlackService } from '../src/modules/slack/slack.service';
import { MempalaceService } from '../src/modules/slack/mempalace.service';
import type { SlackConversation } from '../src/modules/slack/slack.types';
import { readdirSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockSlackService = {
  getConversations: jest.fn(),
  getMessagesSince: jest.fn(),
  buildMessage: jest.fn(),
  resolveUserName: jest.fn(),
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
      text: 'Ship it on Friday',
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
    mockSlackService.getMessagesSince.mockResolvedValue([
      { ts: '1700000200.000000', userId: 'U456', text: 'Review my PR?' },
    ]);
    mockSlackService.resolveUserName.mockResolvedValue('Victor');

    await service.ingest();

    const stagingDir = (service as any).stagingDir;
    const files = readdirSync(stagingDir);
    expect(files[0]).toContain('dm-victor');
  });
});
