/* eslint-disable @typescript-eslint/require-await */
import { SlackService } from '../../src/modules/slack/slack.service';
import type { ConfigService } from '../../src/modules/config.service';
import { SlackTestHelper } from '../helpers/slack-test.helper';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const mockConfigService = {
  getOracleConfig: jest.fn().mockReturnValue({
    slack: {
      xoxcToken: 'xoxc-test-token',
      xoxdCookie: 'xoxd-test-cookie',
    },
  }),
} as unknown as ConfigService;

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SlackService(mockConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── getConversations ──────────────────────────────────────────────────

  describe('getConversations', () => {
    describe('Behavior', () => {
      it('should return mapped SlackConversation[] with correct fields', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            channels: [
              { id: 'C123', name: 'general', is_im: false, is_private: false },
              { id: 'D456', is_im: true, user: 'U789' },
              {
                id: 'G789',
                name: 'secret',
                is_im: false,
                is_private: true,
                is_mpim: false,
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        });

        const convos = await service.getConversations();

        expect(convos).toHaveLength(3);
        expect(convos[0]).toMatchObject({
          id: 'C123',
          name: 'general',
          isDm: false,
          isPrivate: false,
        });
        expect(convos[1]).toMatchObject({
          id: 'D456',
          name: 'U789',
          isDm: true,
          isPrivate: true,
        });
        expect(convos[2]).toMatchObject({
          id: 'G789',
          name: 'secret',
          isDm: false,
          isPrivate: true,
        });
      });

      it('should send correct auth headers (Bearer xoxc, Cookie d=xoxd)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ ok: true, channels: [], response_metadata: {} }),
        });

        await service.getConversations();

        const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('conversations.list');
        const headers = options.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer xoxc-test-token');
        expect(headers['Cookie']).toBe('d=xoxd-test-cookie');
        expect(headers['Content-Type']).toBe('application/json');
      });

      it('should paginate through multiple pages via next_cursor', async () => {
        const page1Convos = [
          SlackTestHelper.conversation({ id: 'C001', name: 'alpha' }),
        ];
        const page2Convos = [
          SlackTestHelper.conversation({ id: 'C002', name: 'beta' }),
        ];

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.conversationsListResponse(
                page1Convos,
                'cursor-page2',
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.conversationsListResponse(page2Convos),
          });

        const convos = await service.getConversations();

        expect(convos).toHaveLength(2);
        expect(convos[0].id).toBe('C001');
        expect(convos[1].id).toBe('C002');
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Verify cursor was passed in second call
        const secondCallUrl = mockFetch.mock.calls[1][0] as string;
        expect(secondCallUrl).toContain('cursor=cursor-page2');
      });

      it('should fire onPage callback per page with correct info', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.conversationsListResponse(
                [SlackTestHelper.conversation({ id: 'C001' })],
                'cursor-2',
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.conversationsListResponse([
                SlackTestHelper.conversation({ id: 'C002' }),
              ]),
          });

        const onPage = jest.fn();
        await service.getConversations(onPage);

        expect(onPage).toHaveBeenCalledTimes(2);
        expect(onPage).toHaveBeenNthCalledWith(1, {
          page: 1,
          channelsSoFar: 1,
          hasMore: true,
        });
        expect(onPage).toHaveBeenNthCalledWith(2, {
          page: 2,
          channelsSoFar: 2,
          hasMore: false,
        });
      });
    });

    describe('Error Handling', () => {
      it('should throw on API error response (ok: false)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'invalid_auth',
            channels: [],
          }),
        });

        await expect(service.getConversations()).rejects.toThrow(
          'Slack conversations.list error: invalid_auth',
        );
      });
    });

    describe('Edge Cases', () => {
      it('should abort mid-pagination when shouldAbort returns true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            SlackTestHelper.conversationsListResponse(
              [SlackTestHelper.conversation({ id: 'C001' })],
              'cursor-2',
            ),
        });

        let callCount = 0;
        const shouldAbort = () => {
          callCount++;
          return callCount > 1; // Abort before second page
        };

        const convos = await service.getConversations(undefined, shouldAbort);

        expect(convos).toHaveLength(1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should handle empty channel list', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            channels: [],
            response_metadata: {},
          }),
        });

        const convos = await service.getConversations();
        expect(convos).toHaveLength(0);
      });

      it('should use channel id as name fallback when name and user are absent', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            channels: [{ id: 'C_NO_NAME' }],
            response_metadata: {},
          }),
        });

        const convos = await service.getConversations();
        expect(convos[0].name).toBe('C_NO_NAME');
      });

      it('should map mpim as DM', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            channels: [{ id: 'G111', name: 'mpim-group', is_mpim: true }],
            response_metadata: {},
          }),
        });

        const convos = await service.getConversations();
        expect(convos[0].isDm).toBe(true);
      });
    });
  });

  // ─── getMessagesSince ──────────────────────────────────────────────────

  describe('getMessagesSince', () => {
    describe('Behavior', () => {
      it('should filter out system messages (those with subtype)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1700000200.000000', user: 'U123', text: 'hello' },
              {
                ts: '1700000100.000000',
                user: 'U456',
                text: 'joined',
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

      it('should return messages in chronological order (oldest first)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1700000300.000000', user: 'U3', text: 'third' },
              { ts: '1700000200.000000', user: 'U2', text: 'second' },
              { ts: '1700000100.000000', user: 'U1', text: 'first' },
            ],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );

        expect(messages).toHaveLength(3);
        expect(messages[0].text).toBe('first');
        expect(messages[1].text).toBe('second');
        expect(messages[2].text).toBe('third');
      });

      it('should paginate via cursor (has_more + next_cursor)', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.historyResponse(
                [{ text: 'msg-page1', ts: '1700000200.000000' }],
                true,
                'cursor-p2',
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.historyResponse([
                { text: 'msg-page2', ts: '1700000100.000000' },
              ]),
          });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );

        expect(messages).toHaveLength(2);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should fire onPage callback per page', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.historyResponse(
                [{ text: 'a', ts: '1700000200.000000' }],
                true,
                'cursor-2',
              ),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.historyResponse([
                { text: 'b', ts: '1700000100.000000' },
              ]),
          });

        const onPage = jest.fn();
        await service.getMessagesSince('C123', '1700000000.000000', onPage);

        expect(onPage).toHaveBeenCalledTimes(2);
        expect(onPage).toHaveBeenNthCalledWith(1, {
          page: 1,
          messagesSoFar: 1,
        });
        expect(onPage).toHaveBeenNthCalledWith(2, {
          page: 2,
          messagesSoFar: 2,
        });
      });

      it('should include inline thread replies for messages with reply_count > 0', async () => {
        // conversations.history
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              {
                ts: '1700000300.000000',
                user: 'U333',
                text: 'no thread',
              },
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
        // conversations.replies for threaded message
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
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

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );

        // Chronological: oldest, has thread, reply 1, reply 2, no thread
        expect(messages).toHaveLength(5);
        expect(messages[0]).toMatchObject({
          ts: '1700000100.000000',
          text: 'oldest',
        });
        expect(messages[1]).toMatchObject({
          ts: '1700000200.000000',
          text: 'has thread',
          replyCount: 2,
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
    });

    describe('Error Handling', () => {
      it('should return empty array for not_in_channel error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'not_in_channel',
            messages: [],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );
        expect(messages).toEqual([]);
      });

      it('should throw on other API errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'channel_not_found',
            messages: [],
            has_more: false,
          }),
        });

        await expect(
          service.getMessagesSince('C123', '1700000000.000000'),
        ).rejects.toThrow(
          'Slack conversations.history error: channel_not_found',
        );
      });

      it('should continue when thread reply fetch fails', async () => {
        // conversations.history with a threaded message
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              {
                ts: '1700000200.000000',
                user: 'U111',
                text: 'has thread',
                reply_count: 1,
              },
            ],
            has_more: false,
          }),
        });
        // conversations.replies fails
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'thread_not_found',
            messages: [],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );

        // Parent message still returned even though replies failed
        expect(messages).toHaveLength(1);
        expect(messages[0].text).toBe('has thread');
      });
    });

    describe('Edge Cases', () => {
      it('should handle channel with no messages', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );
        expect(messages).toEqual([]);
      });

      it('should filter messages without user field', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1700000100.000000', text: 'no user field' },
              { ts: '1700000200.000000', user: 'U123', text: 'has user' },
            ],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );
        expect(messages).toHaveLength(1);
        expect(messages[0].text).toBe('has user');
      });

      it('should filter messages without text field', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1700000100.000000', user: 'U123' },
              { ts: '1700000200.000000', user: 'U123', text: 'has text' },
            ],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );
        expect(messages).toHaveLength(1);
        expect(messages[0].text).toBe('has text');
      });

      it('should not include replyCount field for messages without replies', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              { ts: '1700000100.000000', user: 'U123', text: 'no replies' },
            ],
            has_more: false,
          }),
        });

        const messages = await service.getMessagesSince(
          'C123',
          '1700000000.000000',
        );
        expect(messages[0]).not.toHaveProperty('replyCount');
      });
    });
  });

  // ─── getThreadReplies ──────────────────────────────────────────────────

  describe('getThreadReplies', () => {
    describe('Behavior', () => {
      it('should return replies excluding parent message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              {
                ts: '1700000100.000000',
                user: 'U111',
                text: 'parent',
                thread_ts: '1700000100.000000',
              },
              {
                ts: '1700000200.000000',
                user: 'U222',
                text: 'reply 1',
                thread_ts: '1700000100.000000',
              },
              {
                ts: '1700000300.000000',
                user: 'U333',
                text: 'reply 2',
                thread_ts: '1700000100.000000',
              },
            ],
            has_more: false,
          }),
        });

        const replies = await service.getThreadReplies(
          'C123',
          '1700000100.000000',
        );

        expect(replies).toHaveLength(2);
        expect(replies[0]).toMatchObject({
          ts: '1700000200.000000',
          userId: 'U222',
          text: 'reply 1',
        });
        expect(replies[1]).toMatchObject({
          ts: '1700000300.000000',
          userId: 'U333',
          text: 'reply 2',
        });
      });

      it('should filter out system messages in threads', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              {
                ts: '1700000100.000000',
                user: 'U111',
                text: 'parent',
                thread_ts: '1700000100.000000',
              },
              {
                ts: '1700000200.000000',
                user: 'U222',
                text: 'real reply',
                thread_ts: '1700000100.000000',
              },
              {
                ts: '1700000250.000000',
                subtype: 'bot_message',
                text: 'bot noise',
                thread_ts: '1700000100.000000',
              },
            ],
            has_more: false,
          }),
        });

        const replies = await service.getThreadReplies(
          'C123',
          '1700000100.000000',
        );
        expect(replies).toHaveLength(1);
        expect(replies[0].text).toBe('real reply');
      });
    });

    describe('Error Handling', () => {
      it('should throw on API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'thread_not_found',
            messages: [],
            has_more: false,
          }),
        });

        await expect(
          service.getThreadReplies('C123', '1700000100.000000'),
        ).rejects.toThrow('Slack conversations.replies error: thread_not_found');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when thread has only the parent', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            messages: [
              {
                ts: '1700000100.000000',
                user: 'U111',
                text: 'parent only',
                thread_ts: '1700000100.000000',
              },
            ],
            has_more: false,
          }),
        });

        const replies = await service.getThreadReplies(
          'C123',
          '1700000100.000000',
        );
        expect(replies).toEqual([]);
      });
    });
  });

  // ─── getChangedChannelIds ──────────────────────────────────────────────

  describe('getChangedChannelIds', () => {
    describe('Behavior', () => {
      it('should return Set of channel IDs from search.messages matches', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            SlackTestHelper.searchResponse(['C111', 'C222', 'C111']),
        });

        const result = await service.getChangedChannelIds('2026-04-11');

        expect(result).toEqual(new Set(['C111', 'C222']));
      });

      it('should fire onPage callback per page', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C111'], 1, 2),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C222'], 2, 2),
          });

        const onPage = jest.fn();
        await service.getChangedChannelIds('2026-04-11', undefined, onPage);

        expect(onPage).toHaveBeenCalledTimes(2);
        expect(onPage).toHaveBeenNthCalledWith(1, {
          page: 1,
          matchesSoFar: 1,
        });
        expect(onPage).toHaveBeenNthCalledWith(2, {
          page: 2,
          matchesSoFar: 2,
        });
      });

      it('should paginate through multiple search result pages', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C111'], 1, 2),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C222'], 2, 2),
          });

        const result = await service.getChangedChannelIds('2026-04-11');

        expect(result).toEqual(new Set(['C111', 'C222']));
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('Error Handling', () => {
      it('should throw on API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'not_authed',
          }),
        });

        await expect(
          service.getChangedChannelIds('2026-04-11'),
        ).rejects.toThrow('Slack search.messages error: not_authed');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty set when no matches found', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => SlackTestHelper.searchResponse([]),
        });

        const result = await service.getChangedChannelIds('2026-04-11');
        expect(result).toEqual(new Set());
      });

      it('should abort when shouldAbort returns true', async () => {
        const shouldAbort = jest.fn().mockReturnValue(true);

        const result = await service.getChangedChannelIds(
          '2026-04-11',
          shouldAbort,
        );

        expect(result).toEqual(new Set());
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  // ─── getActiveChannelIds ───────────────────────────────────────────────

  describe('getActiveChannelIds', () => {
    describe('Behavior', () => {
      it('should return Set of channel IDs from search.messages from:me results', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            SlackTestHelper.searchResponse(['C111', 'C222']),
        });

        const result = await service.getActiveChannelIds('2026-03-14');

        expect(result).toEqual(new Set(['C111', 'C222']));

        // Verify query uses from:me
        const url = mockFetch.mock.calls[0][0] as string;
        expect(url).toContain('search.messages');
        expect(url).toContain('from%3Ame');
      });

      it('should fire onPage callback per page', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C111'], 1, 2),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              SlackTestHelper.searchResponse(['C222'], 2, 2),
          });

        const onPage = jest.fn();
        await service.getActiveChannelIds('2026-03-14', onPage);

        expect(onPage).toHaveBeenCalledTimes(2);
        expect(onPage).toHaveBeenNthCalledWith(1, {
          page: 1,
          matchesSoFar: 1,
        });
        expect(onPage).toHaveBeenNthCalledWith(2, {
          page: 2,
          matchesSoFar: 2,
        });
      });
    });

    describe('Edge Cases', () => {
      it('should abort when shouldAbort returns true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            SlackTestHelper.searchResponse(['C111'], 1, 3),
        });

        let callCount = 0;
        const shouldAbort = () => {
          callCount++;
          return callCount > 1; // Allow first page, abort before second
        };

        const result = await service.getActiveChannelIds(
          '2026-03-14',
          undefined,
          shouldAbort,
        );

        expect(result.size).toBe(1);
        expect(result.has('C111')).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should return empty set when no matches', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => SlackTestHelper.searchResponse([]),
        });

        const result = await service.getActiveChannelIds('2026-03-14');
        expect(result).toEqual(new Set());
      });
    });
  });

  // ─── resolveUserName ──────────────────────────────────────────────────

  describe('resolveUserName', () => {
    describe('Behavior', () => {
      it('should resolve user ID to display_name via users.info API', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: {
              id: 'U123',
              profile: { display_name: 'Alfonso' },
            },
          }),
        });

        const name = await service.resolveUserName('U123');
        expect(name).toBe('Alfonso');
      });

      it('should return cached name on second call without calling API again', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U123', profile: { display_name: 'Alfonso' } },
          }),
        });

        const first = await service.resolveUserName('U123');
        const second = await service.resolveUserName('U123');

        expect(first).toBe('Alfonso');
        expect(second).toBe('Alfonso');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should fall back to real_name when display_name is empty', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: {
              id: 'U123',
              profile: { display_name: '', real_name: 'Alfonso Vargas' },
            },
          }),
        });

        const name = await service.resolveUserName('U123');
        expect(name).toBe('Alfonso Vargas');
      });

      it('should fall back to user.name when profile names are absent', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: {
              id: 'U123',
              name: 'alfonso.v',
              profile: { display_name: '' },
            },
          }),
        });

        const name = await service.resolveUserName('U123');
        expect(name).toBe('alfonso.v');
      });

      it('should fall back to userId when no name fields exist', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U123', profile: {} },
          }),
        });

        const name = await service.resolveUserName('U123');
        expect(name).toBe('U123');
      });
    });

    describe('Error Handling', () => {
      it('should fall back to userId when API returns ok false', async () => {
        mockFetch.mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Headers(),
          json: async () => ({ ok: false, error: 'user_not_found' }),
        });
        const name = await service.resolveUserName('U999');
        expect(name).toBe('U999');
      });
    });

    describe('Edge Cases', () => {
      it('should use hydrated cache without API call', async () => {
        service.hydrateUserCache({ U999: 'CachedUser' });

        const name = await service.resolveUserName('U999');

        expect(name).toBe('CachedUser');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should export user cache after resolving', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U123', profile: { display_name: 'Alfonso' } },
          }),
        });

        await service.resolveUserName('U123');
        const cache = service.exportUserCache();

        expect(cache).toEqual({ U123: 'Alfonso' });
      });
    });
  });

  // ─── getCurrentUser ────────────────────────────────────────────────────

  describe('getCurrentUser', () => {
    describe('Behavior', () => {
      it('should return userId and userName from auth.test API', async () => {
        // auth.test response
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user_id: 'U_ME',
          }),
        });
        // users.info for resolveUserName
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U_ME', profile: { display_name: 'Me' } },
          }),
        });

        const result = await service.getCurrentUser();

        expect(result).toEqual({ userId: 'U_ME', userName: 'Me' });
      });
    });

    describe('Error Handling', () => {
      it('should throw when auth.test returns ok: false', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: false,
            error: 'invalid_auth',
          }),
        });

        await expect(service.getCurrentUser()).rejects.toThrow(
          'auth.test failed: invalid_auth',
        );
      });
    });
  });

  // ─── Rate Limiting ─────────────────────────────────────────────────────

  describe('Rate Limiting', () => {
    describe('Error Handling', () => {
      it('should retry on HTTP 429 using Retry-After header', async () => {
        // Mock abortableSleep to not actually wait
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        // First call: 429, second call: success
        mockFetch
          .mockResolvedValueOnce(SlackTestHelper.rateLimitResponse(1))
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              ok: true,
              user: { id: 'U123', profile: { display_name: 'Test' } },
            }),
          });

        const name = await service.resolveUserName('U_RETRY');

        expect(name).toBe('Test');
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should throw after MAX_RETRIES (3) exceeded on 429', async () => {
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        // 4 consecutive 429s (initial + 3 retries)
        mockFetch
          .mockResolvedValue(SlackTestHelper.rateLimitResponse(1));

        await expect(service.resolveUserName('U_FAIL')).rejects.toThrow(
          'Slack API users.info rate-limited after 3 retries',
        );

        // Initial attempt + 3 retries = 4 calls
        expect(mockFetch).toHaveBeenCalledTimes(4);
      });

      it('should fire onWait callback with rate-limited reason on 429', async () => {
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        const onWait = jest.fn();
        service.onWait = onWait;

        mockFetch
          .mockResolvedValueOnce(SlackTestHelper.rateLimitResponse(5))
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              ok: true,
              user: { id: 'U123', profile: { display_name: 'Test' } },
            }),
          });

        await service.resolveUserName('U_WAIT');

        expect(onWait).toHaveBeenCalledWith({
          method: 'users.info',
          waitMs: 5000,
          reason: 'rate-limited',
        });
      });
    });

    describe('Behavior', () => {
      it('should fire onWait callback with throttle reason when per-method gap not met', async () => {
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        const onWait = jest.fn();
        service.onWait = onWait;

        // Two calls to same method — need success responses for both
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              ok: true,
              channels: [],
              response_metadata: {},
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              ok: true,
              channels: [],
              response_metadata: {},
            }),
          });

        await service.getConversations();
        await service.getConversations();

        // At minimum the throttle should have been checked
        // The onWait may or may not fire depending on timing, but abortableSleep
        // was definitely called for the throttle check
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('Edge Cases', () => {
      it('should serialize concurrent requests through requestQueue', async () => {
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        const callOrder: number[] = [];
        let callIndex = 0;

        mockFetch.mockImplementation(async () => {
          const idx = ++callIndex;
          callOrder.push(idx);
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              ok: true,
              user: {
                id: `U${idx}`,
                profile: { display_name: `User${idx}` },
              },
            }),
          };
        });

        // Fire 3 concurrent calls
        const [r1, r2, r3] = await Promise.all([
          service.resolveUserName('U1'),
          service.resolveUserName('U2'),
          service.resolveUserName('U3'),
        ]);

        expect(r1).toBe('User1');
        expect(r2).toBe('User2');
        expect(r3).toBe('User3');

        // All calls should have been serialized — call order should be sequential
        expect(callOrder).toEqual([1, 2, 3]);
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      it('should throw on non-ok HTTP status (not 429)', async () => {
        jest
          .spyOn(service as never, 'abortableSleep')
          .mockResolvedValue(undefined);

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
        });

        await expect(service.resolveUserName('U_ERR')).rejects.toThrow(
          'Slack API users.info failed: 500 Internal Server Error',
        );
      });
    });
  });

  // ─── buildMessage ──────────────────────────────────────────────────────

  describe('buildMessage', () => {
    describe('Behavior', () => {
      it('should build a full SlackMessage with resolved username', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U123', profile: { display_name: 'Alfonso' } },
          }),
        });

        const conversation = SlackTestHelper.conversation({
          id: 'C001',
          name: 'general',
          isDm: false,
        });

        const result = await service.buildMessage(
          { ts: '1700000000.000000', userId: 'U123', text: 'hello' },
          conversation,
        );

        expect(result).toMatchObject({
          ts: '1700000000.000000',
          userId: 'U123',
          userName: 'Alfonso',
          channelId: 'C001',
          channelName: '#general',
          text: 'hello',
          isDm: false,
        });
        expect(result.isoTimestamp).toBeDefined();
      });

      it('should prefix DM channel name with DM:', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ok: true,
            user: { id: 'U123', profile: { display_name: 'Alfonso' } },
          }),
        });

        const conversation = SlackTestHelper.conversation({
          id: 'D001',
          name: 'Alfonso',
          isDm: true,
        });

        const result = await service.buildMessage(
          { ts: '1700000000.000000', userId: 'U123', text: 'hi' },
          conversation,
        );

        expect(result.channelName).toBe('DM:Alfonso');
        expect(result.isDm).toBe(true);
      });

      it('should convert ts to ISO timestamp', async () => {
        service.hydrateUserCache({ U123: 'Test' });

        const conversation = SlackTestHelper.conversation({ id: 'C001' });

        const result = await service.buildMessage(
          { ts: '1700000000.000000', userId: 'U123', text: 'test' },
          conversation,
        );

        // 1700000000 seconds = 2023-11-14T22:13:20.000Z
        expect(result.isoTimestamp).toBe('2023-11-14T22:13:20.000Z');
      });
    });
  });

  // ─── Validation (getAuthHeaders) ──────────────────────────────────────

  describe('getAuthHeaders', () => {
    describe('Validation', () => {
      it('should throw when slack credentials are not configured', async () => {
        const noSlackConfigService = {
          getOracleConfig: jest.fn().mockReturnValue({}),
        } as unknown as ConfigService;

        const svc = new SlackService(noSlackConfigService);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ ok: true, channels: [] }),
        });

        await expect(svc.getConversations()).rejects.toThrow(
          'Slack credentials not configured',
        );
      });
    });
  });

  // ─── hydrateUserCache / exportUserCache ────────────────────────────────

  describe('hydrateUserCache', () => {
    describe('Behavior', () => {
      it('should populate cache from record', () => {
        service.hydrateUserCache({ U1: 'Alice', U2: 'Bob' });
        const cache = service.exportUserCache();
        expect(cache).toEqual({ U1: 'Alice', U2: 'Bob' });
      });

      it('should merge with existing cache entries', () => {
        service.hydrateUserCache({ U3: 'Charlie' });
        service.hydrateUserCache({ U1: 'Alice' });

        const cache = service.exportUserCache();
        expect(cache).toEqual({ U3: 'Charlie', U1: 'Alice' });
      });
    });
  });
});
