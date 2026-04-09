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

/** State persisted to ~/.config/tawtui/oracle-state.json */
export interface OracleState {
  lastChecked: string | null;
  channelCursors: Record<string, string>;
}
