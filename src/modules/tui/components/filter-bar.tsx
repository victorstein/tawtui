import { createSignal, Show, For, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { TaskwarriorService } from '../../taskwarrior.service';
import {
  lerpHex,
  darkenHex,
  LEFT_CAP,
  RIGHT_CAP,
  getTagGradient,
  getAuthorGradient,
  VIRTUAL_TAGS,
} from '../utils';
import {
  BG_SURFACE,
  BG_INPUT,
  BG_SELECTED,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_FAINT,
  ACCENT_PRIMARY,
  ACCENT_TERTIARY,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
  COLOR_SUCCESS,
} from '../theme';

/** Maximum number of suggestion items visible in the dropdown. */
const MAX_VISIBLE_SUGGESTIONS = 5;

interface FilterBarProps {
  /** Current filter text value (two-way binding). */
  filterText: string;
  /** Called when the user updates the text input. */
  onFilterTextChange: (value: string) => void;
  /** Called when the user presses Enter to apply the filter. */
  onApply: (filterText: string) => void;
  /** Called when the user presses Esc to clear and close. */
  onClear: () => void;
  /** Whether the filter input should be focused. */
  focused: boolean;
}

/**
 * Access the TaskwarriorService bridged from NestJS DI via globalThis.
 */
function getTaskwarriorService(): TaskwarriorService | null {
  return (globalThis as any).__tawtui?.taskwarriorService ?? null;
}

/**
 * Parse the filter text into individual chip tokens.
 * Recognises patterns like `project:work`, `+urgent`, `priority:H`, etc.
 */
function parseFilterChips(text: string): string[] {
  if (!text.trim()) return [];
  return text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Priority gradient endpoints keyed by level letter. */
const PRIORITY_GRADIENTS: Record<string, { start: string; end: string }> = {
  H: { start: PRIORITY_H, end: darkenHex(PRIORITY_H, 0.55) },
  M: { start: PRIORITY_M, end: darkenHex(PRIORITY_M, 0.55) },
  L: { start: PRIORITY_L, end: darkenHex(PRIORITY_L, 0.55) },
};

/** Resolve a chip token to its gradient start/end colors. */
function getChipGradient(chip: string): { start: string; end: string } {
  // Tags: +tagName
  if (chip.startsWith('+')) {
    return getTagGradient(chip.slice(1));
  }

  // Projects: project:name
  if (chip.startsWith('project:')) {
    const name = chip.slice('project:'.length);
    const grad = getAuthorGradient(name);
    // Blend toward project teal so projects feel distinct from author pills
    return {
      start: lerpHex(PROJECT_COLOR, grad.start, 0.35),
      end: lerpHex(darkenHex(PROJECT_COLOR, 0.6), grad.end, 0.35),
    };
  }

  // Priority: priority:H/M/L
  if (chip.startsWith('priority:')) {
    const level = chip.slice('priority:'.length).toUpperCase();
    return (
      PRIORITY_GRADIENTS[level] ?? {
        start: ACCENT_PRIMARY,
        end: darkenHex(ACCENT_PRIMARY, 0.55),
      }
    );
  }

  // Description search: description.has:, description:, description.contains:
  if (chip.startsWith('description')) {
    return {
      start: ACCENT_TERTIARY,
      end: darkenHex(ACCENT_TERTIARY, 0.55),
    };
  }

  // Default: primary accent gradient
  return { start: ACCENT_PRIMARY, end: darkenHex(ACCENT_PRIMARY, 0.55) };
}

/** Determine the suggestion category prefix icon and gradient for coloring. */
function getSuggestionGradient(suggestion: string): {
  start: string;
  end: string;
} {
  return getChipGradient(suggestion);
}

export function FilterBar(props: FilterBarProps) {
  // Suggestions state
  const [showSuggestions, setShowSuggestions] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = createSignal(0);

  /** Fetch tags and projects from TaskwarriorService for suggestions. */
  async function loadSuggestions(): Promise<void> {
    const tw = getTaskwarriorService();
    if (!tw) return;

    try {
      const [projects, tags] = await Promise.all([
        tw.getProjects(),
        tw.getTags(),
      ]);

      const items: string[] = [];

      // Projects as `project:<name>`
      for (const proj of projects) {
        if (proj) items.push(`project:${proj}`);
      }

      // Tags as `+<name>` (exclude virtual tags)
      for (const tag of tags) {
        if (tag && !VIRTUAL_TAGS.has(tag)) items.push(`+${tag}`);
      }

      // Priority shortcuts
      items.push('priority:H', 'priority:M', 'priority:L');

      // Description search
      items.push('description.has:');

      setSuggestions(items);
    } catch {
      // Silently ignore — suggestions are a convenience, not critical
    }
  }

  /** Filter suggestions based on the last token being typed. */
  const filteredSuggestions = () => {
    const all = suggestions();
    const text = props.filterText.trim();
    if (!text) return all;

    // Match against the last whitespace-separated token
    const tokens = text.split(/\s+/);
    const lastToken = tokens[tokens.length - 1].toLowerCase();
    if (!lastToken) return all;

    return all.filter((s) => s.toLowerCase().includes(lastToken));
  };

  // Load suggestions on mount
  onMount(() => {
    loadSuggestions();
  });

  // Handle keyboard events within the filter bar
  useKeyboard((key) => {
    if (!props.focused) return;

    // Tab toggles the suggestions popup
    if (key.name === 'tab' && !key.shift) {
      if (!showSuggestions()) {
        setShowSuggestions(true);
        setSelectedSuggestion(0);
      } else {
        // Cycle through visible suggestions
        const maxVisible = Math.min(filteredSuggestions().length, MAX_VISIBLE_SUGGESTIONS);
        if (maxVisible > 0) {
          setSelectedSuggestion((prev) => (prev + 1) % maxVisible);
        }
      }
      return;
    }

    // Shift+Tab cycles backwards through suggestions
    if (key.name === 'tab' && key.shift) {
      if (showSuggestions()) {
        const maxVisible = Math.min(filteredSuggestions().length, MAX_VISIBLE_SUGGESTIONS);
        if (maxVisible > 0) {
          setSelectedSuggestion((prev) => (prev - 1 + maxVisible) % maxVisible);
        }
      }
      return;
    }

    // Enter in suggestions mode: insert selected suggestion
    if (key.name === 'return' && showSuggestions()) {
      const filtered = filteredSuggestions();
      const idx = selectedSuggestion();
      if (filtered.length > 0 && idx < filtered.length) {
        // Replace the last token with the selected suggestion
        const tokens = props.filterText.trim().split(/\s+/);
        tokens[tokens.length - 1] = filtered[idx];
        props.onFilterTextChange(tokens.join(' ') + ' ');
      }
      setShowSuggestions(false);
      return;
    }

    // Enter without suggestions: apply the filter
    if (key.name === 'return' && !showSuggestions()) {
      props.onApply(props.filterText);
      return;
    }

    // Escape: close suggestions if open, otherwise clear & close
    if (key.name === 'escape') {
      if (showSuggestions()) {
        setShowSuggestions(false);
      } else {
        props.onClear();
      }
      return;
    }

    // Any other key hides suggestions (user is typing)
    if (showSuggestions() && key.name !== 'up' && key.name !== 'down') {
      // Keep suggestions visible while typing — but reset selection
      setSelectedSuggestion(0);
    }

    // Arrow keys within suggestions
    if (showSuggestions()) {
      if (key.name === 'down' || key.name === 'j') {
        const maxVisible = Math.min(filteredSuggestions().length, MAX_VISIBLE_SUGGESTIONS);
        if (maxVisible > 0) {
          setSelectedSuggestion((prev) => Math.min(prev + 1, maxVisible - 1));
        }
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
        return;
      }
    }
  });

  const chips = () => parseFilterChips(props.filterText);

  return (
    <box flexDirection="column" width="100%" position="relative">
      {/* Main filter bar row */}
      <box height={1} width="100%" flexDirection="row" paddingX={1}>
        {/* Filter icon / label */}
        <text fg={ACCENT_PRIMARY} attributes={1}>
          {'/ Filter: '}
        </text>

        {/* Text input */}
        <input
          flexGrow={1}
          value={props.filterText}
          placeholder="e.g. project:work +urgent priority:H description.has:fix"
          focused={props.focused && !showSuggestions()}
          backgroundColor={BG_INPUT}
          textColor={FG_NORMAL}
          onInput={(val: string) => props.onFilterTextChange(val)}
        />
      </box>

      {/* Active filter chips — gradient pills */}
      <Show when={chips().length > 0}>
        <box height={1} width="100%" flexDirection="row" paddingX={1}>
          <text fg={FG_DIM}>{'Active: '}</text>
          <For each={chips()}>
            {(chip, index) => {
              const grad = getChipGradient(chip);
              const label = ` ${chip} `;
              return (
                <>
                  <Show when={index() > 0}>
                    <text> </text>
                  </Show>
                  <text fg={grad.start}>{LEFT_CAP}</text>
                  <For each={label.split('')}>
                    {(char, i) => {
                      const t = label.length > 1 ? i() / (label.length - 1) : 0;
                      return (
                        <text
                          fg={FG_PRIMARY}
                          bg={lerpHex(grad.start, grad.end, t)}
                          attributes={1}
                        >
                          {char}
                        </text>
                      );
                    }}
                  </For>
                  <text fg={grad.end}>{RIGHT_CAP}</text>
                </>
              );
            }}
          </For>
        </box>
      </Show>

      {/* Key hints — hidden when suggestions are open */}
      <Show when={!showSuggestions()}>
        <box height={1} width="100%" flexDirection="row" paddingX={1}>
          {/* Enter pill */}
          <text fg={COLOR_SUCCESS}>{LEFT_CAP}</text>
          <text fg={FG_PRIMARY} bg={COLOR_SUCCESS} attributes={1}>
            {' Enter '}
          </text>
          <text fg={COLOR_SUCCESS}>{RIGHT_CAP}</text>
          <text fg={FG_DIM}>{' Apply  '}</text>

          {/* Esc pill */}
          <text fg={ACCENT_PRIMARY}>{LEFT_CAP}</text>
          <text fg={FG_PRIMARY} bg={ACCENT_PRIMARY} attributes={1}>
            {' Esc '}
          </text>
          <text fg={ACCENT_PRIMARY}>{RIGHT_CAP}</text>
          <text fg={FG_DIM}>{' Clear  '}</text>

          {/* Tab pill */}
          <text fg={ACCENT_TERTIARY}>{LEFT_CAP}</text>
          <text fg={FG_PRIMARY} bg={ACCENT_TERTIARY} attributes={1}>
            {' Tab '}
          </text>
          <text fg={ACCENT_TERTIARY}>{RIGHT_CAP}</text>
          <text fg={FG_DIM}>{' Suggest'}</text>
        </box>
      </Show>

      {/* Suggestions popup — absolutely positioned to overlay content below */}
      <Show when={showSuggestions() && filteredSuggestions().length > 0}>
        <box
          position="absolute"
          top={1 + (chips().length > 0 ? 1 : 0)}
          left={0}
          width="100%"
          zIndex={50}
          flexDirection="column"
          backgroundColor={BG_SURFACE}
        >
          <box height={1} paddingX={1} flexDirection="row">
            <text fg={ACCENT_TERTIARY}>{LEFT_CAP}</text>
            <text fg={FG_PRIMARY} bg={ACCENT_TERTIARY} attributes={1}>
              {' Suggestions '}
            </text>
            <text fg={ACCENT_TERTIARY}>{RIGHT_CAP}</text>
            <text fg={FG_FAINT}>
              {' Tab/\u2191\u2193 cycle \u00b7 Enter select'}
            </text>
          </box>
          <For each={filteredSuggestions().slice(0, MAX_VISIBLE_SUGGESTIONS)}>
            {(suggestion, index) => {
              const isSelected = () => index() === selectedSuggestion();
              const grad = getSuggestionGradient(suggestion);
              return (
                <box
                  height={1}
                  paddingX={1}
                  backgroundColor={isSelected() ? BG_SELECTED : undefined}
                  flexDirection="row"
                >
                  {/* Colored pip indicator */}
                  <text fg={isSelected() ? grad.start : FG_FAINT}>
                    {isSelected() ? '\u25B6 ' : '  '}
                  </text>
                  {/* Suggestion text with gradient accent for selected */}
                  <Show
                    when={isSelected()}
                    fallback={<text fg={FG_DIM}>{suggestion}</text>}
                  >
                    <text fg={grad.start} attributes={1}>
                      {suggestion}
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
      </Show>
    </box>
  );
}
