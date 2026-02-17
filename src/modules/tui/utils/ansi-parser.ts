export interface AnsiSegment {
  text: string;
  fg?: string;
  bg?: string;
  attrs: number;
}

export type ParsedLine = AnsiSegment[];

// Attribute bitmask constants
const BOLD = 1;
const DIM = 2;
const ITALIC = 4;
const UNDERLINE = 8;
const BLINK = 16;
const INVERSE = 32;
const HIDDEN = 64;
const STRIKETHROUGH = 128;

const ANSI_COLORS = [
  '#000000',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#555753',
  '#ef2929',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
];

function color256ToHex(n: number): string {
  if (n < 16) return ANSI_COLORS[n];
  if (n < 232) {
    const idx = n - 16;
    const b = (idx % 6) * 51;
    const g = (Math.floor(idx / 6) % 6) * 51;
    const r = Math.floor(idx / 36) * 51;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  const v = (n - 232) * 10 + 8;
  return `#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

interface AnsiState {
  fg: string | undefined;
  bg: string | undefined;
  attrs: number;
}

function applySgrParams(params: number[], state: AnsiState): void {
  let i = 0;
  while (i < params.length) {
    const p = params[i];

    if (p === 0) {
      // Reset all
      state.fg = undefined;
      state.bg = undefined;
      state.attrs = 0;
    } else if (p === 1) {
      state.attrs |= BOLD;
    } else if (p === 2) {
      state.attrs |= DIM;
    } else if (p === 3) {
      state.attrs |= ITALIC;
    } else if (p === 4) {
      state.attrs |= UNDERLINE;
    } else if (p === 5 || p === 6) {
      state.attrs |= BLINK;
    } else if (p === 7) {
      state.attrs |= INVERSE;
    } else if (p === 8) {
      state.attrs |= HIDDEN;
    } else if (p === 9) {
      state.attrs |= STRIKETHROUGH;
    } else if (p === 22) {
      state.attrs &= ~(BOLD | DIM);
    } else if (p === 23) {
      state.attrs &= ~ITALIC;
    } else if (p === 24) {
      state.attrs &= ~UNDERLINE;
    } else if (p === 25) {
      state.attrs &= ~BLINK;
    } else if (p === 27) {
      state.attrs &= ~INVERSE;
    } else if (p === 28) {
      state.attrs &= ~HIDDEN;
    } else if (p === 29) {
      state.attrs &= ~STRIKETHROUGH;
    } else if (p >= 30 && p <= 37) {
      state.fg = ANSI_COLORS[p - 30];
    } else if (p === 38) {
      // Extended foreground
      if (
        i + 1 < params.length &&
        params[i + 1] === 5 &&
        i + 2 < params.length
      ) {
        state.fg = color256ToHex(params[i + 2]);
        i += 2;
      } else if (
        i + 1 < params.length &&
        params[i + 1] === 2 &&
        i + 4 < params.length
      ) {
        state.fg = rgbToHex(params[i + 2], params[i + 3], params[i + 4]);
        i += 4;
      }
    } else if (p === 39) {
      state.fg = undefined;
    } else if (p >= 40 && p <= 47) {
      state.bg = ANSI_COLORS[p - 40];
    } else if (p === 48) {
      // Extended background
      if (
        i + 1 < params.length &&
        params[i + 1] === 5 &&
        i + 2 < params.length
      ) {
        state.bg = color256ToHex(params[i + 2]);
        i += 2;
      } else if (
        i + 1 < params.length &&
        params[i + 1] === 2 &&
        i + 4 < params.length
      ) {
        state.bg = rgbToHex(params[i + 2], params[i + 3], params[i + 4]);
        i += 4;
      }
    } else if (p === 49) {
      state.bg = undefined;
    } else if (p >= 90 && p <= 97) {
      state.fg = ANSI_COLORS[p - 90 + 8];
    } else if (p >= 100 && p <= 107) {
      state.bg = ANSI_COLORS[p - 100 + 8];
    }

    i++;
  }
}

// Regex to match all escape sequences:
// - CSI sequences: \x1b[ ... <final byte>
// - OSC sequences: \x1b] ... (ST = \x07 or \x1b\\)
// - SGR is CSI ending in 'm', handled specially
const ESC_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[([0-9;]*)([A-Za-z@`])|\x1b\](?:[^\x07\x1b]*(?:\x07|\x1b\\))/g;

/**
 * Parse ANSI-encoded text into lines of styled segments.
 * Only handles SGR sequences (\x1b[...m). All other escape sequences are stripped.
 */
export function parseAnsiText(input: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const state: AnsiState = { fg: undefined, bg: undefined, attrs: 0 };

  // Split input by newlines first, then process each line
  const rawLines = input.split('\n');

  for (const rawLine of rawLines) {
    const segments: AnsiSegment[] = [];
    let lastIndex = 0;
    let currentText = '';

    ESC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ESC_RE.exec(rawLine)) !== null) {
      // Collect text before this escape sequence
      if (match.index > lastIndex) {
        currentText += rawLine.slice(lastIndex, match.index);
      }
      lastIndex = match.index + match[0].length;

      // Check if this is a CSI sequence (not an OSC)
      if (match[2] !== undefined) {
        if (match[2] === 'm') {
          // SGR sequence — flush current text segment, then apply style changes
          if (currentText.length > 0) {
            pushSegment(segments, currentText, state);
            currentText = '';
          }

          const paramStr = match[1];
          if (paramStr === '' || paramStr === undefined) {
            // \x1b[m is equivalent to \x1b[0m
            applySgrParams([0], state);
          } else {
            const params = paramStr.split(';').map((s) => parseInt(s, 10) || 0);
            applySgrParams(params, state);
          }
        }
        // All other CSI sequences (cursor movement, etc.) are stripped
      }
      // OSC sequences are also stripped (captured but ignored)
    }

    // Remaining text after last escape sequence
    if (lastIndex < rawLine.length) {
      currentText += rawLine.slice(lastIndex);
    }

    if (currentText.length > 0) {
      pushSegment(segments, currentText, state);
    }

    // If the line is empty (no segments), push an empty line
    if (segments.length === 0) {
      segments.push({ text: '', attrs: 0 });
    }

    lines.push(segments);
  }

  return lines;
}

function pushSegment(
  segments: AnsiSegment[],
  text: string,
  state: AnsiState,
): void {
  const last = segments[segments.length - 1];
  // Merge with previous segment if styling matches
  if (
    last &&
    last.fg === state.fg &&
    last.bg === state.bg &&
    last.attrs === state.attrs
  ) {
    last.text += text;
  } else {
    segments.push({
      text,
      fg: state.fg,
      bg: state.bg,
      attrs: state.attrs,
    });
  }
}
