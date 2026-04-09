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
      json: async () => ({
        ok: true,
        user: { id: 'U123', name: 'alfonso.v', profile: { display_name: '' } },
      }),
    });

    const name = await service.resolveUserName('U123');
    expect(name).toBe('alfonso.v');
  });
});
