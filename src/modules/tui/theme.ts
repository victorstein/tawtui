/**
 * TaWTUI color palette and theme constants.
 *
 * Palette:
 *   #39383a  — charcoal (backgrounds)
 *   #85a7a0  — sage green (secondary accent, muted text)
 *   #be9a87  — warm tan (dim text, subtle accents)
 *   #b88877  — dusty rose (highlights, secondary)
 *   #cb6836  — burnt orange (primary accent, active elements)
 */

// ── Core palette ──────────────────────────────────────────────
export const P = {
  bg:        '#39383a',
  surface:   '#85a7a0',
  accent:    '#be9a87',
  highlight: '#b88877',
  primary:   '#cb6836',
} as const;

// ── Semantic tokens ───────────────────────────────────────────

// Backgrounds
export const BG_BASE       = P.bg;
export const BG_SURFACE    = '#45433f';   // slightly lighter charcoal for panels
export const BG_SELECTED   = '#504d49';   // warm gray for selection highlight
export const BG_INPUT      = '#45433f';
export const BG_INPUT_FOCUS = '#504d49';

// Borders
export const BORDER_DIM    = '#5a5755';
export const BORDER_ACTIVE = P.primary;
export const BORDER_DIALOG = P.highlight;

// Text
export const FG_PRIMARY    = '#ffffff';
export const FG_NORMAL     = '#e8e0d8';   // warm off-white
export const FG_DIM        = P.accent;    // warm tan
export const FG_MUTED      = P.surface;   // sage green
export const FG_FAINT      = '#5e5b58';   // dark warm gray

// Accents
export const ACCENT_PRIMARY   = P.primary;    // burnt orange — active tabs, headers, key hints
export const ACCENT_SECONDARY = P.highlight;  // dusty rose — chips, tags, secondary highlights
export const ACCENT_TERTIARY  = P.surface;    // sage green — borders, subtle accents

// Semantic
export const COLOR_ERROR   = '#d95555';
export const COLOR_SUCCESS = P.surface;   // sage green
export const COLOR_WARNING = '#d4a74a';

// Priority colors
export const PRIORITY_H = '#d95555';      // warm red
export const PRIORITY_M = P.primary;      // burnt orange
export const PRIORITY_L = P.surface;      // sage green

// Separator
export const SEPARATOR_COLOR = '#5a5755';

// Tag colors — distinct hues derived from the palette for visual variety
export const TAG_COLORS = [
  P.highlight,  // dusty rose
  P.surface,    // sage green
  P.accent,     // warm tan
  P.primary,    // burnt orange
  COLOR_WARNING, // warm amber
  '#a88fa0',    // muted mauve (complement to sage)
  '#7eb8a8',    // light sage (lighter surface)
  '#d4a07a',    // light tan (lighter accent)
] as const;

export const PROJECT_COLOR = P.surface;  // sage green — distinct from tags
