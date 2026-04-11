#!/usr/bin/env bun
//
// Standalone MCP channel server for Oracle events.
// Claude Code spawns this as a subprocess via .mcp.json.
// Listens on localhost:7851 for HTTP POSTs from tawtui's
// ingestion service and forwards them as channel notifications.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ORACLE_CHANNEL_PORT } from './oracle-channel.types';

const mcp = new Server(
  { name: 'oracle-channel', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: [
      'You receive events from the Oracle channel as <channel source="oracle-channel" event_type="..."> tags.',
      'Each event contains a JSON payload in the body.',
      '',
      'Event types:',
      '',
      '- sync-complete: New Slack messages were synced into mempalace.',
      '  The payload contains messagesStored (count), channels (Slack channel names),',
      '  and rejectedTasks (previously rejected proposals — do NOT re-propose these).',
      '  Search mempalace for conversations from the listed channels,',
      '  extract commitments, cross-check against rejectedTasks and existing +oracle tasks,',
      '  and propose any new action items. If nothing new, stay completely silent.',
      '',
      '- daily-digest: First launch of the day. Provide a broad summary of recent',
      '  conversations, key threads, unresolved discussions, and any commitments found.',
      '  More narrative than sync-complete. Still propose tasks for explicit commitments.',
      '  The payload contains rejectedTasks to avoid re-proposing.',
      '',
      'When you find actionable items, start your response with [ORACLE ALERT].',
      'When you have nothing to report, produce no output at all.',
    ].join('\n'),
  },
);

await mcp.connect(new StdioServerTransport());

Bun.serve({
  port: ORACLE_CHANNEL_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    const body = await req.text();

    let eventType = 'unknown';
    try {
      const parsed = JSON.parse(body) as { type?: string };
      eventType = parsed.type ?? 'unknown';
    } catch {
      // body isn't JSON — forward as-is
    }

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { event_type: eventType },
      },
    });

    return new Response('ok');
  },
});
