import { Injectable } from '@nestjs/common';
import type { DiffLineMap, DiffFileEntry } from './hunk-review.types';

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

@Injectable()
export class PrDiffParser {
  parse(raw: string): DiffLineMap {
    const files: DiffFileEntry[] = [];
    let current: DiffFileEntry | null = null;
    let newLine = 0;

    for (const line of raw.split('\n')) {
      const gitHeader = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (gitHeader) {
        current = {
          path: gitHeader[2],
          newLines: new Set<number>(),
          changeKind: 'modified',
          binary: false,
        };
        files.push(current);
        newLine = 0;
        continue;
      }
      if (!current) continue;

      if (line.startsWith('new file mode')) {
        current.changeKind = 'added';
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        current.changeKind = 'deleted';
        continue;
      }
      if (line.startsWith('rename from ')) {
        current.changeKind = 'renamed';
        current.oldPath = line.slice('rename from '.length);
        continue;
      }
      if (line.startsWith('rename to ')) {
        current.changeKind = 'renamed';
        continue;
      }
      if (line.startsWith('Binary files ')) {
        current.binary = true;
        continue;
      }

      const header = line.match(HUNK_HEADER);
      if (header) {
        newLine = Number(header[1]);
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (newLine === 0) continue;

      if (line.startsWith('+')) {
        current.newLines.add(newLine);
        newLine += 1;
      } else if (line.startsWith('-')) {
        /* removed line: no new-file line consumed */
      } else if (line.startsWith(' ')) {
        current.newLines.add(newLine);
        newLine += 1;
      }
    }

    return { files };
  }
}
