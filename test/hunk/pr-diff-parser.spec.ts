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
});
