import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';
import type {
  SlackConversation,
  SlackConversationListResponse,
  SlackHistoryResponse,
  SlackMessage,
  SlackUserInfoResponse,
} from './slack.types';

const SLACK_API = 'https://slack.com/api';

/**
 * Minimum gap in ms between calls per Slack API method.
 * Conservative but not excessive — 429 retry handles actual limits.
 */
const RATE_LIMITS: Record<string, number> = {
  'conversations.list': 500, // Tier 2: burst-friendly, retry on 429
  'conversations.history': 400, // Tier 3: ~50/min with headroom
  'users.info': 200, // Tier 4: 100+/min, mostly cached anyway
};

const MAX_RETRIES = 3;

@Injectable()
export class SlackService {
  /** In-memory cache of userId → display name to avoid redundant API calls */
  private readonly userNameCache = new Map<string, string>();

  /** Tracks the last call timestamp (ms) per Slack API method for throttling */
  private readonly lastCallTime = new Map<string, number>();

  /** Optional callback fired when waiting (throttle or 429 retry) */
  onWait:
    | ((info: {
        method: string;
        waitMs: number;
        reason: 'throttle' | 'rate-limited';
      }) => void)
    | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** Load persisted user name cache (call on startup or before ingestion) */
  hydrateUserCache(names: Record<string, string>): void {
    for (const [id, name] of Object.entries(names)) {
      this.userNameCache.set(id, name);
    }
  }

  /** Export current user name cache for persistence */
  exportUserCache(): Record<string, string> {
    return Object.fromEntries(this.userNameCache);
  }

  private getAuthHeaders(): Record<string, string> {
    const oracle = this.configService.getOracleConfig();
    if (!oracle.slack) throw new Error('Slack credentials not configured');
    return {
      Authorization: `Bearer ${oracle.slack.xoxcToken}`,
      Cookie: `d=${oracle.slack.xoxdCookie}`,
      'Content-Type': 'application/json',
    };
  }

  /** Wait until the per-method rate limit gap has elapsed */
  private async throttle(method: string): Promise<void> {
    const minGap = RATE_LIMITS[method];
    if (!minGap) return;

    const lastTime = this.lastCallTime.get(method);
    if (lastTime !== undefined) {
      const elapsed = Date.now() - lastTime;
      if (elapsed < minGap) {
        const waitMs = minGap - elapsed;
        this.onWait?.({ method, waitMs, reason: 'throttle' });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private async slackGet<T>(
    method: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle(method);
      this.lastCallTime.set(method, Date.now());

      const res = await fetch(url.toString(), {
        headers: this.getAuthHeaders(),
      });

      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `Slack API ${method} rate-limited after ${MAX_RETRIES} retries`,
          );
        }
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
        this.onWait?.({
          method,
          waitMs: retryAfter * 1000,
          reason: 'rate-limited',
        });
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        throw new Error(
          `Slack API ${method} failed: ${res.status} ${res.statusText}`,
        );
      }

      return res.json() as Promise<T>;
    }

    // Unreachable — loop always returns or throws — but satisfies TypeScript
    throw new Error(`Slack API ${method} failed: exhausted retries`);
  }

  /** Fetch all conversations (channels + DMs) the user is a member of */
  async getConversations(
    onPage?: (info: {
      page: number;
      channelsSoFar: number;
      hasMore: boolean;
    }) => void,
  ): Promise<SlackConversation[]> {
    const results: SlackConversation[] = [];
    let cursor = '';
    let page = 0;

    do {
      page++;
      const params: Record<string, string> = {
        types: 'public_channel,private_channel,im,mpim',
        exclude_archived: 'true',
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackConversationListResponse>(
        'conversations.list',
        params,
      );

      if (!data.ok) {
        throw new Error(`Slack conversations.list error: ${data.error}`);
      }

      for (const ch of data.channels) {
        results.push({
          id: ch.id,
          name: ch.name ?? ch.user ?? ch.id,
          isDm: !!ch.is_im || !!ch.is_mpim,
          isPrivate: !!ch.is_private || !!ch.is_im,
        });
      }

      cursor = data.response_metadata?.next_cursor ?? '';
      onPage?.({ page, channelsSoFar: results.length, hasMore: !!cursor });
    } while (cursor);

    return results;
  }

  /**
   * Fetch messages in a channel newer than `oldestTs`.
   * Filters out system messages (channel_join, bot_message, etc.).
   * Returns messages in chronological order (oldest first).
   */
  async getMessagesSince(
    channelId: string,
    oldestTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string }>> {
    const results: Array<{ ts: string; userId: string; text: string }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        oldest: oldestTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackHistoryResponse>(
        'conversations.history',
        params,
      );

      if (!data.ok) {
        if (data.error === 'not_in_channel') return [];
        throw new Error(`Slack conversations.history error: ${data.error}`);
      }

      for (const msg of data.messages) {
        if (msg.subtype || !msg.user || !msg.text) continue;
        results.push({ ts: msg.ts, userId: msg.user, text: msg.text });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    return results.reverse();
  }

  /** Resolve a Slack user ID to a display name, with in-memory caching */
  async resolveUserName(userId: string): Promise<string> {
    if (this.userNameCache.has(userId)) {
      return this.userNameCache.get(userId)!;
    }

    const data = await this.slackGet<SlackUserInfoResponse>('users.info', {
      user: userId,
    });

    const name =
      data.user?.profile?.display_name ||
      data.user?.profile?.real_name ||
      data.user?.real_name ||
      data.user?.name ||
      userId;

    this.userNameCache.set(userId, name);
    return name;
  }

  /** Get the current authenticated user's ID and display name */
  async getCurrentUser(): Promise<{ userId: string; userName: string }> {
    const auth = await this.slackGet<{
      ok: boolean;
      user_id: string;
      error?: string;
    }>('auth.test');
    if (!auth.ok) throw new Error(`auth.test failed: ${auth.error}`);
    const userName = await this.resolveUserName(auth.user_id);
    return { userId: auth.user_id, userName };
  }

  /** Build a full SlackMessage with resolved username and channel name */
  async buildMessage(
    raw: { ts: string; userId: string; text: string },
    conversation: SlackConversation,
  ): Promise<SlackMessage> {
    const userName = await this.resolveUserName(raw.userId);
    const unixSeconds = parseFloat(raw.ts);
    const isoTimestamp = new Date(unixSeconds * 1000).toISOString();

    return {
      ts: raw.ts,
      userId: raw.userId,
      userName,
      channelId: conversation.id,
      channelName: conversation.isDm
        ? `DM:${userName}`
        : `#${conversation.name}`,
      text: raw.text,
      isoTimestamp,
      isDm: conversation.isDm,
    };
  }
}
