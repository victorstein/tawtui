import type { ReviewFinding } from '../../src/modules/hunk-review.types';
import { PrDiffParser } from '../../src/modules/pr-diff-parser.service';

const SIMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' export { x };',
  '',
].join('\n');

describe('PrDiffParser', () => {
  let parser: PrDiffParser;
  beforeEach(() => {
    parser = new PrDiffParser();
  });

  describe('parse - Behavior', () => {
    it('should map added and context lines to new-file line numbers', () => {
      const map = parser.parse(SIMPLE);
      const file = map.files.find((f) => f.path === 'src/a.ts');
      expect(file).toBeDefined();
      expect([...file!.newLines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect(file!.changeKind).toBe('modified');
      expect(file!.binary).toBe(false);
    });
  });

  describe('parse - Edge Cases', () => {
    it('should flag binary files with no anchorable lines', () => {
      const raw = [
        'diff --git a/img.png b/img.png',
        'index 0..1 100644',
        'Binary files a/img.png and b/img.png differ',
        '',
      ].join('\n');
      const f = parser.parse(raw).files[0];
      expect(f.binary).toBe(true);
      expect(f.newLines.size).toBe(0);
    });
    it('should detect renames and capture the old path', () => {
      const raw = [
        'diff --git a/old.ts b/new.ts',
        'similarity index 90%',
        'rename from old.ts',
        'rename to new.ts',
        '',
      ].join('\n');
      const f = parser.parse(raw).files[0];
      expect(f.changeKind).toBe('renamed');
      expect(f.path).toBe('new.ts');
      expect(f.oldPath).toBe('old.ts');
    });
    it('should detect pure deletions', () => {
      const raw = [
        'diff --git a/gone.ts b/gone.ts',
        'deleted file mode 100644',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-line one',
        '-line two',
        '',
      ].join('\n');
      const f = parser.parse(raw).files[0];
      expect(f.changeKind).toBe('deleted');
      expect(f.newLines.size).toBe(0);
    });
    it('should parse multiple files independently', () => {
      const raw = [
        'diff --git a/x.ts b/x.ts',
        '@@ -1,1 +1,2 @@',
        ' a',
        '+b',
        'diff --git a/y.ts b/y.ts',
        '@@ -1,1 +1,1 @@',
        ' c',
        '',
      ].join('\n');
      const map = parser.parse(raw);
      expect(map.files.map((f) => f.path)).toEqual(['x.ts', 'y.ts']);
      expect([...map.files[0].newLines]).toEqual([1, 2]);
      expect([...map.files[1].newLines]).toEqual([1]);
    });
  });

  describe('validateAnchors', () => {
    it('should anchor findings on diff-present lines and route the rest to the body', () => {
      const map = parser.parse(SIMPLE); // src/a.ts newLines {1,2,3,4}
      const findings: ReviewFinding[] = [
        {
          file: 'src/a.ts',
          line: 2,
          severity: 'warning',
          summary: 'on diff line',
        },
        {
          file: 'src/a.ts',
          line: 99,
          severity: 'info',
          summary: 'off diff line',
        },
        {
          file: 'other.ts',
          line: 5,
          severity: 'info',
          summary: 'unknown file',
        },
        {
          file: 'src/a.ts',
          line: null,
          severity: 'info',
          summary: 'file-level',
        },
      ];
      const { anchored, unanchored } = parser.validateAnchors(findings, map);
      expect(anchored).toHaveLength(1);
      expect(anchored[0].line).toBe(2);
      expect(unanchored).toHaveLength(3);
    });
  });

  describe('isOverThreshold', () => {
    it('should flag diffs larger than the byte threshold', () => {
      expect(parser.isOverThreshold('x'.repeat(101), 100)).toBe(true);
      expect(parser.isOverThreshold('x'.repeat(50), 100)).toBe(false);
    });
  });
});
