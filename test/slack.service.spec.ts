/* eslint-disable @typescript-eslint/require-await */
import { SlackService } from '../src/modules/slack/slack.service';
import { ConfigService } from '../src/modules/config.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const mockConfigService = {
  getOracleConfig: jest.fn().mockReturnValue({
    pollIntervalSeconds: 300,
    slack: {
      xoxcToken: 'xoxc-test',
      xoxdCookie: 'xoxd-test',
      teamId: 'T123',
      teamName: 'Test',
    },
  }),
} as unknown as ConfigService;

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(() => {
    service = new SlackService(mockConfigService);
    mockFetch.mockReset();
  });

  it('getConversations returns mapped conversations', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        channels: [
          { id: 'C123', name: 'general', is_im: false, is_private: false },
          { id: 'D456', is_im: true, user: 'U789' },
        ],
        response_metadata: { next_cursor: '' },
      }),
    });

    const convos = await service.getConversations();
    expect(convos).toHaveLength(2);
    expect(convos[0]).toMatchObject({
      id: 'C123',
      name: 'general',
      isDm: false,
    });
    expect(convos[1]).toMatchObject({ id: 'D456', isDm: true });
  });

  it('getConversations sends correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channels: [], response_metadata: {} }),
    });

    await service.getConversations();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('conversations.list');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer xoxc-test',
    );
    expect((options.headers as Record<string, string>)['Cookie']).toBe(
      'd=xoxd-test',
    );
  });

  it('getMessagesSince returns only user messages (filters subtypes)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000200.000000', user: 'U123', text: 'hello' },
          {
            ts: '1700000100.000000',
            user: 'U456',
            text: 'world',
            subtype: 'channel_join',
          },
        ],
        has_more: false,
      }),
    });

    const messages = await service.getMessagesSince(
      'C123',
      '1700000000.000000',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hello');
  });

  it('resolveUserName returns display name from user profile', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: 'U123', profile: { display_name: 'Alfonso' } },
      }),
    });

    const name = await service.resolveUserName('U123');
    expect(name).toBe('Alfonso');
  });

  it('resolveUserName returns fallback when profile has no display_name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: 'U123', name: 'alfonso.v', profile: { display_name: '' } },
      }),
    });

    const name = await service.resolveUserName('U123');
    expect(name).toBe('alfonso.v');
  });

  it('getMessagesSince fetches thread replies inline after parent', async () => {
    // First call: conversations.history
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000300.000000', user: 'U333', text: 'no thread' },
          {
            ts: '1700000200.000000',
            user: 'U111',
            text: 'has thread',
            reply_count: 2,
          },
          { ts: '1700000100.000000', user: 'U444', text: 'oldest' },
        ],
        has_more: false,
      }),
    });
    // Second call: conversations.replies for the threaded message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: '1700000200.000000',
            user: 'U111',
            text: 'has thread',
            thread_ts: '1700000200.000000',
          },
          {
            ts: '1700000210.000000',
            user: 'U222',
            text: 'reply 1',
            thread_ts: '1700000200.000000',
          },
          {
            ts: '1700000220.000000',
            user: 'U333',
            text: 'reply 2',
            thread_ts: '1700000200.000000',
          },
        ],
        has_more: false,
      }),
    });

    const messages = await service.getMessagesSince('C123', '1700000000.000000');

    // Chronological: oldest, has thread, reply 1, reply 2, no thread
    expect(messages).toHaveLength(5);
    expect(messages[0]).toMatchObject({
      ts: '1700000100.000000',
      text: 'oldest',
    });
    expect(messages[1]).toMatchObject({
      ts: '1700000200.000000',
      text: 'has thread',
    });
    expect(messages[1].threadTs).toBeUndefined();
    expect(messages[2]).toMatchObject({
      ts: '1700000210.000000',
      text: 'reply 1',
      threadTs: '1700000200.000000',
    });
    expect(messages[3]).toMatchObject({
      ts: '1700000220.000000',
      text: 'reply 2',
      threadTs: '1700000200.000000',
    });
    expect(messages[4]).toMatchObject({
      ts: '1700000300.000000',
      text: 'no thread',
    });
  });

  it('getThreadReplies returns replies excluding parent message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000100.000000', user: 'U111', text: 'parent message', thread_ts: '1700000100.000000' },
          { ts: '1700000200.000000', user: 'U222', text: 'first reply', thread_ts: '1700000100.000000' },
          { ts: '1700000300.000000', user: 'U333', text: 'second reply', thread_ts: '1700000100.000000' },
        ],
        has_more: false,
      }),
    });

    const replies = await service.getThreadReplies('C123', '1700000100.000000');
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({ ts: '1700000200.000000', userId: 'U222', text: 'first reply' });
    expect(replies[1]).toMatchObject({ ts: '1700000300.000000', userId: 'U333', text: 'second reply' });
  });

  it('getThreadReplies filters out system messages in threads', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: '1700000100.000000', user: 'U111', text: 'parent', thread_ts: '1700000100.000000' },
          { ts: '1700000200.000000', user: 'U222', text: 'real reply', thread_ts: '1700000100.000000' },
          { ts: '1700000250.000000', subtype: 'bot_message', text: 'bot noise', thread_ts: '1700000100.000000' },
        ],
        has_more: false,
      }),
    });

    const replies = await service.getThreadReplies('C123', '1700000100.000000');
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe('real reply');
  });
});
