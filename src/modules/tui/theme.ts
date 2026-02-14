/**
 * TaWTUI color palette and theme constants.
 *
 * Palette:
 *   #0a2131  — dark navy (deepest background)
 *   #1a5764  — teal (panels, secondary surfaces)
 *   #fc6529  — bright orange (primary accent, active elements)
 *   #dcca99  — warm cream (dim text, subtle accents)
 *   #445f80  — slate blue (highlights, secondary accent)
 */

// ── Core palette ──────────────────────────────────────────────
export const P = {
  bg: '#0a2131',
  surface: '#1a5764',
  accent: '#dcca99',
  highlight: '#445f80',
  primary: '#fc6529',
} as const;

// ── Semantic tokens ───────────────────────────────────────────

// Backgrounds
export const BG_BASE = P.bg;
export const BG_SURFACE = '#0e2a3d'; // slightly lighter navy
export const BG_SELECTED = '#133347'; // lighter navy for selection
export const BG_INPUT = '#0e2a3d';
export const BG_INPUT_FOCUS = '#133347';

// Borders
export const BORDER_DIM = '#1a4050'; // dark teal-navy
export const BORDER_ACTIVE = P.primary; // bright orange
export const BORDER_DIALOG = P.surface; // teal

// Text
export const FG_PRIMARY = '#ffffff';
export const FG_NORMAL = '#e8e4dc'; // warm off-white
export const FG_DIM = '#c0bab0'; // light warm gray — readable but dimmer than FG_NORMAL
export const FG_MUTED = '#8a9098'; // medium blue-gray — readable but muted
export const FG_FAINT = '#5a6a75'; // dark blue-gray — subtle but legible

// Accents
export const ACCENT_PRIMARY = P.primary; // bright orange — active tabs, headers, key hints
export const ACCENT_SECONDARY = '#6a88a8'; // lighter slate blue — readable as text
export const ACCENT_TERTIARY = '#2a7a8a'; // lighter teal — readable as text

// Semantic
export const COLOR_ERROR = '#e05555';
export const COLOR_SUCCESS = '#5aaa6a'; // green (distinct from palette)
export const COLOR_WARNING = '#d4a74a';

// Priority colors
export const PRIORITY_H = '#e05555'; // red
export const PRIORITY_M = P.primary; // bright orange
export const PRIORITY_L = '#5aaa6a'; // green

// Separator
export const SEPARATOR_COLOR = '#1a4050';

// Tag colors — distinct hues derived from the palette for visual variety
export const TAG_COLORS = [
  '#6a88a8', // slate blue (lighter)
  '#2a8a7a', // teal-green
  P.accent, // warm cream
  P.primary, // bright orange
  '#d4a74a', // warm amber
  '#8a7aaa', // muted purple
  '#5aaaa0', // bright teal
  '#c8a070', // warm tan
] as const;

export const PROJECT_COLOR = '#2a8a7a'; // teal-green
