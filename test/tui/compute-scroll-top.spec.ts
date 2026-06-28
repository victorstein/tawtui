import { computeScrollTop } from '../../src/modules/tui/utils';

describe('computeScrollTop', () => {
  describe('Behavior', () => {
    it('should return null when the item is already fully visible', () => {
      const result = computeScrollTop({
        itemTop: 4,
        itemBottom: 7,
        viewTop: 0,
        viewHeight: 20,
      });
      expect(result).toBeNull();
    });

    it('should scroll down so the bottom of an item below the fold is visible', () => {
      const result = computeScrollTop({
        itemTop: 12,
        itemBottom: 15,
        viewTop: 0,
        viewHeight: 10,
      });
      expect(result).toBe(5); // itemBottom(15) - viewHeight(10)
    });

    it('should scroll up to the top of an item above the fold', () => {
      const result = computeScrollTop({
        itemTop: 0,
        itemBottom: 3,
        viewTop: 12,
        viewHeight: 10,
      });
      expect(result).toBe(0); // itemTop(0)
    });
  });

  describe('Edge Cases', () => {
    it('should return null when the item bottom exactly meets the fold', () => {
      const result = computeScrollTop({
        itemTop: 7,
        itemBottom: 10,
        viewTop: 0,
        viewHeight: 10,
      });
      expect(result).toBeNull();
    });

    it('should return null when the item top exactly meets the viewport top', () => {
      const result = computeScrollTop({
        itemTop: 5,
        itemBottom: 8,
        viewTop: 5,
        viewHeight: 10,
      });
      expect(result).toBeNull();
    });

    it('should bottom-align an item taller than the viewport', () => {
      const result = computeScrollTop({
        itemTop: 4,
        itemBottom: 20,
        viewTop: 0,
        viewHeight: 10,
      });
      expect(result).toBe(10); // itemBottom(20) - viewHeight(10)
    });
  });
});
