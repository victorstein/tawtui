/**
 * TaWTUI color palette and theme constants.
 *
 * Palette:
 *   #1c0f4a  — deepest purple (backgrounds)
 *   #572694  — dark purple (borders, secondary surfaces)
 *   #8e3cd9  — medium purple (accents, active borders)
 *   #c334ec  — bright purple (highlights, chips)
 *   #f72cff  — neon pink (primary accent, active elements)
 */

// ── Core palette ──────────────────────────────────────────────
export const P = {
  bg:      '#1c0f4a',
  surface: '#572694',
  accent:  '#8e3cd9',
  highlight: '#c334ec',
  primary: '#f72cff',
} as const;

// ── Semantic tokens ───────────────────────────────────────────

// Backgrounds
export const BG_BASE       = P.bg;
export const BG_SURFACE    = '#2a1560';   // slightly lighter than bg for cards/panels
export const BG_SELECTED   = P.surface;
export const BG_INPUT      = '#2a1560';
export const BG_INPUT_FOCUS = P.surface;

// Borders
export const BORDER_DIM    = '#3d1a6e';
export const BORDER_ACTIVE = P.accent;
export const BORDER_DIALOG = P.accent;

// Text
export const FG_PRIMARY    = '#ffffff';
export const FG_NORMAL     = '#ddddee';
export const FG_DIM        = '#9988bb';
export const FG_MUTED      = '#6b5a8e';
export const FG_FAINT      = '#4a3a6e';

// Accents
export const ACCENT_PRIMARY   = P.primary;    // active tabs, column headers, key hints
export const ACCENT_SECONDARY = P.highlight;  // chips, tags, secondary highlights
export const ACCENT_TERTIARY  = P.accent;     // borders, subtle accents

// Semantic
export const COLOR_ERROR   = '#ff4477';
export const COLOR_SUCCESS = '#55efc4';
export const COLOR_WARNING = '#f0a500';

// Priority colors
export const PRIORITY_H = '#ff4477';
export const PRIORITY_M = '#f0a500';
export const PRIORITY_L = '#55efc4';

// Separator
export const SEPARATOR_COLOR = '#3d1a6e';
