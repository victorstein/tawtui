import { ORACLE_CHANNEL_PORT } from '../../src/modules/oracle/oracle-channel.types';

describe('oracle-channel server', () => {
  const baseUrl = `http://127.0.0.1:${ORACLE_CHANNEL_PORT}`;

  it('exports ORACLE_CHANNEL_PORT as 7851', () => {
    expect(ORACLE_CHANNEL_PORT).toBe(7851);
  });

  // Integration test: start the server, POST to it, verify it responds.
  // The channel server is a standalone Bun script, so we spawn it as a subprocess.
  // NOTE: This test requires Bun runtime and is skipped in Jest/Node.
  // The server's MCP notification behavior is tested via manual integration
  // (Claude Code receives the <channel> tag). The HTTP layer is what we validate here.
  it.skip('responds 200 to POST requests (integration — run with bun test)', () => {
    // This is a manual integration test placeholder.
    // To test: bun run src/modules/oracle/oracle-channel.ts &
    // curl -X POST http://127.0.0.1:7851 -d '{"type":"sync-complete","messagesStored":5,"channels":["#general"],"rejectedTasks":""}'
    // Expected: 200 "ok"
    void baseUrl;
  });
});
