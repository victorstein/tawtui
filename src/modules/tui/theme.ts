/**
 * TaWTUI color palette and theme constants.
 *
 * All semantic tokens reference the core palette (P) or each other.
 * To re-theme the app, only modify the P object.
 */

// ── Core palette ──────────────────────────────────────────────
export const P = {
  // Backgrounds
  bg: '#0a2131', // dark navy (deepest background)
  bgLight: '#0e2a3d', // slightly lighter navy
  bgLighter: '#133347', // lighter navy for selection/focus

  // Surfaces & borders
  surface: '#1a5764', // teal (panels, secondary surfaces)
  border: '#1a4050', // dark teal-navy

  // Accent colors
  primary: '#fc6529', // bright orange (active elements)
  secondary: '#445f80', // slate blue (highlights)
  secondaryLight: '#6a88a8', // lighter slate blue
  tertiary: '#2a7a8a', // lighter teal

  // Warm tones
  cream: '#dcca99', // warm cream (dim text, subtle accents)
  tan: '#c8a070', // warm tan
  amber: '#d4a74a', // warm amber

  // Text shades
  white: '#ffffff',
  offWhite: '#e8e4dc', // warm off-white
  gray: '#c0bab0', // light warm gray
  grayBlue: '#8a9098', // medium blue-gray
  grayDark: '#5a6a75', // dark blue-gray

  // Status colors
  red: '#e05555',
  green: '#5aaa6a',
  tealGreen: '#2a8a7a',
  tealBright: '#5aaaa0',
  purple: '#8a7aaa',
} as const;

// ── Semantic tokens ───────────────────────────────────────────

// Backgrounds
export const BG_BASE = P.bg;
export const BG_SURFACE = P.bgLight;
export const BG_SELECTED = P.bgLighter;
export const BG_INPUT = P.bgLight;
export const BG_INPUT_FOCUS = P.bgLighter;

// Borders
export const BORDER_DIM = P.border;
export const BORDER_ACTIVE = P.primary;
export const BORDER_DIALOG = P.surface;

// Text
export const FG_PRIMARY = P.white;
export const FG_NORMAL = P.offWhite;
export const FG_DIM = P.gray;
export const FG_MUTED = P.grayBlue;
export const FG_FAINT = P.grayDark;

// Accents
export const ACCENT_PRIMARY = P.primary;
export const ACCENT_SECONDARY = P.secondaryLight;
export const ACCENT_TERTIARY = P.tertiary;

// Status
export const COLOR_ERROR = P.red;
export const COLOR_SUCCESS = P.green;
export const COLOR_WARNING = P.amber;

// Priority
export const PRIORITY_H = P.red;
export const PRIORITY_M = P.primary;
export const PRIORITY_L = P.green;

// Separator
export const SEPARATOR_COLOR = P.border;

export const PROJECT_COLOR = P.tealGreen;
