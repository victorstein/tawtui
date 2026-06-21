import {
  HunkReviewPanel,
  formatUnanchoredHeader,
} from '../../src/modules/tui/components/hunk-review-panel';

describe('hunk-review-panel', () => {
  it('should export the panel component', () => {
    expect(typeof HunkReviewPanel).toBe('function');
  });

  it('should surface the un-anchored finding count, never hiding it', () => {
    expect(formatUnanchoredHeader(0)).toBe('Un-anchored findings (0)');
    expect(formatUnanchoredHeader(3)).toBe('Un-anchored findings (3)');
  });
});
