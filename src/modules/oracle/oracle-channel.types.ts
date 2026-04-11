/** Port the oracle channel MCP server listens on (localhost only). */
export const ORACLE_CHANNEL_PORT = 7851;

/** Payload for sync-complete events — fired after ingestion finds new messages. */
export interface SyncCompleteEvent {
  type: 'sync-complete';
  messagesStored: number;
  channels: string[];
  rejectedTasks: string;
}

/** Payload for daily-digest events — fired on first TUI launch of the day. */
export interface DailyDigestEvent {
  type: 'daily-digest';
  rejectedTasks: string;
}

/** Union of all oracle channel event payloads. */
export type OracleChannelEvent = SyncCompleteEvent | DailyDigestEvent;
