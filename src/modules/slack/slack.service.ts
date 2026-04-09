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

@Injectable()
export class SlackService {
  /** In-memory cache of userId → display name to avoid redundant API calls */
  private readonly userNameCache = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  private getAuthHeaders(): Record<string, string> {
    const oracle = this.configService.getOracleConfig();
    if (!oracle.slack) throw new Error('Slack credentials not configured');
    return {
      Authorization: `Bearer ${oracle.slack.xoxcToken}`,
      Cookie: `d=${oracle.slack.xoxdCookie}`,
      'Content-Type': 'application/json',
    };
  }

  private async slackGet<T>(
    method: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url.toString(), { headers: this.getAuthHeaders() });
    if (!res.ok) {
      throw new Error(
        `Slack API ${method} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json() as Promise<T>;
  }

  /** Fetch all conversations (channels + DMs) the user is a member of */
  async getConversations(): Promise<SlackConversation[]> {
    const results: SlackConversation[] = [];
    let cursor = '';

    do {
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
