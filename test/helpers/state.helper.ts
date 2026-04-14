import type { OracleState } from '../../src/modules/slack/slack.types';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class StateHelper {
  static createStateFile(
    state: Partial<OracleState> = {},
  ): { path: string; dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'tawtui-test-state-'));
    const path = join(dir, 'oracle-state.json');
    const full: OracleState = {
      lastChecked: state.lastChecked ?? null,
      channelCursors: state.channelCursors ?? {},
      ...state,
    };
    writeFileSync(path, JSON.stringify(full, null, 2));
    return { path, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  static createRejectedDir(
    entries: Record<string, string> = {},
  ): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'tawtui-test-rejected-'));
    for (const [name, content] of Object.entries(entries)) {
      writeFileSync(join(dir, name), content);
    }
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
}
