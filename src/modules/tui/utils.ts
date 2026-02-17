// src/modules/tui/utils.ts

/** Powerline left cap (right-facing half-circle). */
export const LEFT_CAP = '\uE0B6';

/** Powerline right cap (left-facing half-circle). */
export const RIGHT_CAP = '\uE0B4';

/** Simple djb2 hash — maps a string to a consistent non-negative integer. */
export function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Darken a hex color by multiplying each RGB channel by the given factor. */
export function darkenHex(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/** Linearly interpolate between two hex colors. */
export function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

export const ALLOWED_TAGS = [
  'bug',
  'feature',
  'urgent',
  'review',
  'chore',
] as const;

export const TAG_GRADIENTS: { start: string; end: string }[] = [
  { start: '#e05555', end: '#8a2a2a' }, // bug — red (danger)
  { start: '#5aaa6a', end: '#2a7a8a' }, // feature — green→teal (growth)
  { start: '#fc6529', end: '#d4a74a' }, // urgent — orange→amber (warning)
  { start: '#6a88a8', end: '#8a7aaa' }, // review — blue→purple (analytical)
  { start: '#c8a070', end: '#5a6a75' }, // chore — tan→gray (routine)
  { start: '#5aaaa0', end: '#2a7a8a' }, // pr-review — teal (system tag)
];

const TAG_GRADIENT_MAP: Record<string, { start: string; end: string }> = {
  bug: TAG_GRADIENTS[0],
  feature: TAG_GRADIENTS[1],
  urgent: TAG_GRADIENTS[2],
  review: TAG_GRADIENTS[3],
  chore: TAG_GRADIENTS[4],
  'pr-review': TAG_GRADIENTS[5],
};

/** Convert HSL (h: 0-360, s: 0-100, l: 0-100) to hex color. */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Generate a gradient pair from a tag name hash using HSL color space. */
function generateTagGradient(tag: string): { start: string; end: string } {
  const hash = djb2(tag);
  const hue = hash % 360;
  const start = hslToHex(hue, 55, 55);
  const end = hslToHex((hue + 30) % 360, 40, 35);
  return { start, end };
}

export function getTagGradient(tag: string): { start: string; end: string } {
  return TAG_GRADIENT_MAP[tag] ?? generateTagGradient(tag);
}

/** Generate a gradient pair for a PR author name using HSL color space. */
export function getAuthorGradient(author: string): {
  start: string;
  end: string;
} {
  const hash = djb2(author);
  const hue = (hash * 137) % 360; // different multiplier than tags to avoid collisions
  const start = hslToHex(hue, 50, 45);
  const end = hslToHex((hue + 25) % 360, 35, 30);
  return { start, end };
}
