/** A single message from a Slack conversation */
export interface SlackMessage {
  ts: string;
  userId: string;
  userName: string;
  channelId: string;
  channelName: string;
  text: string;
  isoTimestamp: string;
  isDm: boolean;
}

/** A Slack conversation (channel, DM, group DM) the user is a member of */
export interface SlackConversation {
  id: string;
  name: string;
  isDm: boolean;
  isPrivate: boolean;
}

/** Paginated response from Slack conversations.list */
export interface SlackConversationListResponse {
  ok: boolean;
  channels: Array<{
    id: string;
    name?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    user?: string;
  }>;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

/** Paginated response from Slack conversations.history */
export interface SlackHistoryResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string;
    reply_count?: number;
    thread_ts?: string;
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

/** Paginated response from Slack conversations.replies */
export interface SlackRepliesResponse {
  ok: boolean;
  messages: Array<{
    ts: string;
    user?: string;
    text?: string;
    subtype?: string;
    thread_ts?: string;
  }>;
  has_more: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

/** Response from Slack users.info */
export interface SlackUserInfoResponse {
  ok: boolean;
  user?: {
    id: string;
    real_name?: string;
    name?: string;
    profile?: { display_name?: string; real_name?: string };
  };
  error?: string;
}

/** Response from Slack search.messages */
export interface SlackSearchResponse {
  ok: boolean;
  messages?: {
    matches: Array<{
      channel: { id: string; name?: string };
      ts: string;
    }>;
    paging?: { pages: number; page: number; count: number };
  };
  error?: string;
}

/** State persisted to ~/.config/tawtui/oracle-state.json */
export interface OracleState {
  lastChecked: string | null;
  channelCursors: Record<string, string>;
  /** Persisted userId → display name cache to avoid redundant users.info calls */
  userNames?: Record<string, string>;
  /** Cached conversation list to avoid re-fetching on retry */
  conversations?: SlackConversation[];
  /** Channel IDs detected as active via search (cached for retry) */
  activeChannelIds?: string[];
  /** ISO timestamp of when conversations list was last fetched */
  channelsCachedAt?: string;
  /** ISO timestamp of when active channel detection last ran */
  activeChannelsCachedAt?: string;
  /** Parent messages with threads — checked for new replies on each sync */
  trackedThreads?: Record<
    string,
    Array<{
      threadTs: string;
      lastReplyTs: string;
    }>
  >;
}
