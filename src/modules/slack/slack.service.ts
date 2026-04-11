import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';
import type {
  SlackConversation,
  SlackConversationListResponse,
  SlackHistoryResponse,
  SlackRepliesResponse,
  SlackMessage,
  SlackSearchResponse,
  SlackUserInfoResponse,
} from './slack.types';

const SLACK_API = 'https://slack.com/api';

/**
 * Minimum gap in ms between consecutive calls to the same Slack API method.
 * Aligned with Slack's documented tier limits:
 *   Tier 2: ~20 req/min → 3000ms
 *   Tier 3: ~50 req/min → 1200ms
 *   Tier 4: ~100 req/min → 600ms
 */
const RATE_LIMITS: Record<string, number> = {
  'conversations.list': 3000, // Tier 2
  'conversations.history': 1200, // Tier 3
  'conversations.replies': 1200, // Tier 3
  'users.info': 600, // Tier 4
  'search.messages': 3000, // Tier 2
};

/** Minimum gap in ms between ANY Slack API call (prevents burst across methods) */
const GLOBAL_MIN_GAP_MS = 200;

const MAX_RETRIES = 3;

@Injectable()
export class SlackService {
  /** In-memory cache of userId → display name to avoid redundant API calls */
  private readonly userNameCache = new Map<string, string>();

  /** Tracks the last call timestamp (ms) per Slack API method for throttling */
  private readonly lastCallTime = new Map<string, number>();

  /** Tracks the last call timestamp (ms) across ALL methods for global throttling */
  private lastGlobalCallTime = 0;

  /** Optional callback fired when waiting (throttle or 429 retry) */
  onWait:
    | ((info: {
        method: string;
        waitMs: number;
        reason: 'throttle' | 'rate-limited';
      }) => void)
    | null = null;

  /** Optional abort check — if it returns true, waits are cut short */
  shouldAbort: (() => boolean) | null = null;

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

  /** Sleep that checks shouldAbort every 500ms and throws if aborted */
  private async abortableSleep(ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.shouldAbort?.()) throw new Error('Slack API call aborted');
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, end - Date.now())),
      );
    }
  }

  /** Wait until both per-method and global rate limit gaps have elapsed */
  private async throttle(method: string): Promise<void> {
    // Global throttle: minimum gap between any API call
    const globalElapsed = Date.now() - this.lastGlobalCallTime;
    if (globalElapsed < GLOBAL_MIN_GAP_MS) {
      await this.abortableSleep(GLOBAL_MIN_GAP_MS - globalElapsed);
    }

    // Per-method throttle: respect Slack tier limits
    const minGap = RATE_LIMITS[method];
    if (minGap) {
      const lastTime = this.lastCallTime.get(method);
      if (lastTime !== undefined) {
        const elapsed = Date.now() - lastTime;
        if (elapsed < minGap) {
          const waitMs = minGap - elapsed;
          this.onWait?.({ method, waitMs, reason: 'throttle' });
          await this.abortableSleep(waitMs);
        }
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
      this.lastGlobalCallTime = Date.now();

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
        await this.abortableSleep(retryAfter * 1000);
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
    shouldAbort?: () => boolean,
  ): Promise<SlackConversation[]> {
    const results: SlackConversation[] = [];
    let cursor = '';
    let page = 0;

    do {
      if (shouldAbort?.()) return results;
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
   * Fetch messages in a channel newer than `oldestTs`, including thread replies.
   * For each message with reply_count > 0, fetches the thread and inserts
   * replies inline after the parent. Filters out system messages.
   * Returns messages in chronological order (oldest first).
   */
  async getMessagesSince(
    channelId: string,
    oldestTs: string,
  ): Promise<
    Array<{
      ts: string;
      userId: string;
      text: string;
      threadTs?: string;
      replyCount?: number;
    }>
  > {
    const topLevel: Array<{
      ts: string;
      userId: string;
      text: string;
      replyCount: number;
    }> = [];
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
        topLevel.push({
          ts: msg.ts,
          userId: msg.user,
          text: msg.text,
          replyCount: msg.reply_count ?? 0,
        });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    // Chronological order (history returns newest first)
    topLevel.reverse();

    // Fetch thread replies and insert inline after parent
    const results: Array<{
      ts: string;
      userId: string;
      text: string;
      threadTs?: string;
      replyCount?: number;
    }> = [];
    for (const msg of topLevel) {
      results.push({
        ts: msg.ts,
        userId: msg.userId,
        text: msg.text,
        ...(msg.replyCount > 0 ? { replyCount: msg.replyCount } : {}),
      });

      if (msg.replyCount > 0) {
        if (this.shouldAbort?.()) throw new Error('Slack API call aborted');
        try {
          const replies = await this.getThreadReplies(channelId, msg.ts);
          for (const reply of replies) {
            results.push({ ...reply, threadTs: msg.ts });
          }
        } catch {
          // Thread fetch failed — continue with top-level messages
        }
      }
    }

    return results;
  }

  /**
   * Fetch replies in a thread, excluding the parent message.
   * Returns replies in chronological order (oldest first).
   */
  async getThreadReplies(
    channelId: string,
    threadTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string }>> {
    const results: Array<{ ts: string; userId: string; text: string }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        ts: threadTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackRepliesResponse>(
        'conversations.replies',
        params,
      );

      if (!data.ok) {
        throw new Error(`Slack conversations.replies error: ${data.error}`);
      }

      for (const msg of data.messages) {
        // Skip the parent message (same ts as thread_ts) and system messages
        if (msg.ts === threadTs) continue;
        if (msg.subtype || !msg.user || !msg.text) continue;
        results.push({ ts: msg.ts, userId: msg.user, text: msg.text });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    return results;
  }

  /**
   * Fetch a complete thread: parent message + all replies.
   * Returns messages in chronological order (oldest first).
   */
  async getFullThread(
    channelId: string,
    threadTs: string,
  ): Promise<Array<{ ts: string; userId: string; text: string }>> {
    const results: Array<{ ts: string; userId: string; text: string }> = [];
    let cursor = '';

    do {
      const params: Record<string, string> = {
        channel: channelId,
        ts: threadTs,
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const data = await this.slackGet<SlackRepliesResponse>(
        'conversations.replies',
        params,
      );

      if (!data.ok) {
        throw new Error(`Slack conversations.replies error: ${data.error}`);
      }

      for (const msg of data.messages) {
        if (msg.subtype || !msg.user || !msg.text) continue;
        results.push({ ts: msg.ts, userId: msg.user, text: msg.text });
      }

      cursor = data.has_more ? (data.response_metadata?.next_cursor ?? '') : '';
    } while (cursor);

    return results;
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

  /**
   * Find channel IDs where the current user has posted recently.
   * Uses search.messages with `from:me` to efficiently detect active channels
   * without making per-channel API calls.
   */
  async getActiveChannelIds(
    afterDate: string,
    onPage?: (info: { page: number; matchesSoFar: number }) => void,
    shouldAbort?: () => boolean,
  ): Promise<Set<string>> {
    const channelIds = new Set<string>();
    let page = 1;
    let totalPages = 1;

    do {
      if (shouldAbort?.()) return channelIds;
      const data = await this.slackGet<SlackSearchResponse>('search.messages', {
        query: `from:me after:${afterDate}`,
        count: '100',
        page: String(page),
      });

      if (!data.ok) {
        throw new Error(`Slack search.messages error: ${data.error}`);
      }

      for (const match of data.messages?.matches ?? []) {
        channelIds.add(match.channel.id);
      }

      totalPages = data.messages?.paging?.pages ?? 1;
      onPage?.({ page, matchesSoFar: channelIds.size });
      page++;
    } while (page <= totalPages);

    return channelIds;
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
