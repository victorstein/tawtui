import type {
  SlackConversation,
  SlackHistoryResponse,
  SlackSearchResponse,
  SlackConversationListResponse,
  OracleState,
} from '../../src/modules/slack/slack.types';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class SlackTestHelper {
  static conversation(
    overrides: Partial<SlackConversation> = {},
  ): SlackConversation {
    return {
      id: overrides.id ?? `C${Date.now()}`,
      name: overrides.name ?? 'general',
      isDm: overrides.isDm ?? false,
      isPrivate: overrides.isPrivate ?? false,
    };
  }

  static historyResponse(
    messages: Array<{ text: string; ts?: string; user?: string; reply_count?: number }>,
    hasMore = false,
    nextCursor = '',
  ): SlackHistoryResponse {
    return {
      ok: true,
      messages: messages.map((m, i) => ({
        ts: m.ts ?? `${1700000000 + i}.000000`,
        user: m.user ?? 'U123',
        text: m.text,
        reply_count: m.reply_count,
      })),
      has_more: hasMore,
      response_metadata: nextCursor ? { next_cursor: nextCursor } : undefined,
    };
  }

  static searchResponse(
    channelIds: string[],
    page = 1,
    totalPages = 1,
  ): SlackSearchResponse {
    return {
      ok: true,
      messages: {
        matches: channelIds.map((id) => ({
          channel: { id, name: `channel-${id}` },
          ts: '1700000000.000000',
        })),
        paging: { pages: totalPages, page, count: 100 },
      },
    };
  }

  static conversationsListResponse(
    conversations: SlackConversation[],
    nextCursor = '',
  ): SlackConversationListResponse {
    return {
      ok: true,
      channels: conversations.map((c) => ({
        id: c.id,
        name: c.name,
        is_im: c.isDm,
        is_private: c.isPrivate,
      })),
      response_metadata: nextCursor ? { next_cursor: nextCursor } : undefined,
    };
  }

  static rateLimitResponse(retryAfterSeconds = 5): Response {
    return new Response('', {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    });
  }

  static oracleState(overrides: Partial<OracleState> = {}): OracleState {
    return {
      lastChecked: overrides.lastChecked ?? null,
      channelCursors: overrides.channelCursors ?? {},
      userNames: overrides.userNames,
      conversations: overrides.conversations,
      activeChannelIds: overrides.activeChannelIds,
      channelsCachedAt: overrides.channelsCachedAt,
      activeChannelsCachedAt: overrides.activeChannelsCachedAt,
      trackedThreads: overrides.trackedThreads,
    };
  }

  static mockFetchResponses(...responses: Array<object>): jest.Mock {
    const mock = jest.fn();
    for (const r of responses) {
      if (r instanceof Response) {
        mock.mockResolvedValueOnce(r);
      } else {
        mock.mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Headers(),
          json: async () => r,
        });
      }
    }
    return mock;
  }

  static createStagingDir(
    files: Record<string, object> = {},
  ): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'tawtui-test-staging-'));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(content, null, 2));
    }
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
}
