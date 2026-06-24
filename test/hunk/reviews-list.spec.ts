import {
  reviewStatusGlyph,
  formatReviewLabel,
} from '../../src/modules/tui/components/stacked-list';
import type { HunkReviewRecord } from '../../src/modules/hunk-review.types';

const base: HunkReviewRecord = {
  prKey: 'octo/repo#pr-7-hunk',
  repoOwner: 'octo',
  repoName: 'repo',
  prNumber: 7,
  worktreePath: '/wt',
  port: 0,
  status: 'ready',
  createdAt: 'x',
  chat: [],
};

describe('reviews-list helpers', () => {
  describe('reviewStatusGlyph - Behavior', () => {
    it('should show a checkmark for ready and open', () => {
      expect(reviewStatusGlyph('ready', 0)).toBe('✓');
      expect(reviewStatusGlyph('open', 0)).toBe('✓');
    });
    it('should show a cross for error, interrupted, and killed', () => {
      expect(reviewStatusGlyph('error', 0)).toBe('✗');
      expect(reviewStatusGlyph('interrupted', 0)).toBe('✗');
      expect(reviewStatusGlyph('killed', 0)).toBe('✗');
    });
    it('should show a spinner frame while reviewing/creating', () => {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      expect(frames).toContain(reviewStatusGlyph('reviewing', 3));
      expect(frames).toContain(reviewStatusGlyph('creating', 0));
    });
  });

  describe('formatReviewLabel - Behavior', () => {
    it('should format as PR #n · repo', () => {
      expect(formatReviewLabel(base)).toBe('PR #7 · repo');
    });
  });
});
