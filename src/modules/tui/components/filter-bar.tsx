import { createSignal, Show, For, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { TaskwarriorService } from '../../taskwarrior.service';

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
      const [tags, projects] = await Promise.all([
        tw.getTags(),
        tw.getProjects(),
      ]);

      const items: string[] = [];

      // Projects as `project:<name>`
      for (const proj of projects) {
        if (proj) items.push(`project:${proj}`);
      }

      // Tags as `+<name>`
      for (const tag of tags) {
        if (tag) items.push(`+${tag}`);
      }

      // Priority shortcuts
      items.push('priority:H', 'priority:M', 'priority:L');

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
        // Cycle through visible suggestions (clamped to 10)
        const maxVisible = Math.min(filteredSuggestions().length, 10);
        if (maxVisible > 0) {
          setSelectedSuggestion(
            (prev) => (prev + 1) % maxVisible,
          );
        }
      }
      return;
    }

    // Shift+Tab cycles backwards through suggestions
    if (key.name === 'tab' && key.shift) {
      if (showSuggestions()) {
        const maxVisible = Math.min(filteredSuggestions().length, 10);
        if (maxVisible > 0) {
          setSelectedSuggestion(
            (prev) => (prev - 1 + maxVisible) % maxVisible,
          );
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
        const maxVisible = Math.min(filteredSuggestions().length, 10);
        if (maxVisible > 0) {
          setSelectedSuggestion(
            (prev) => Math.min(prev + 1, maxVisible - 1),
          );
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
    <box flexDirection="column" width="100%">
      {/* Main filter bar row */}
      <box
        height={1}
        width="100%"
        flexDirection="row"
        backgroundColor="#1a1a2e"
        paddingX={1}
      >
        {/* Filter icon / label */}
        <text fg="#e94560" attributes={1}>
          {'/ Filter: '}
        </text>

        {/* Text input */}
        <input
          flexGrow={1}
          value={props.filterText}
          placeholder="e.g. project:work +urgent priority:H"
          focused={props.focused && !showSuggestions()}
          backgroundColor="#232335"
          textColor="#ddddee"
          onInput={(val: string) => props.onFilterTextChange(val)}
        />
      </box>

      {/* Active filter chips */}
      <Show when={chips().length > 0}>
        <box
          height={1}
          width="100%"
          flexDirection="row"
          paddingX={1}
          backgroundColor="#1a1a2e"
        >
          <text fg="#555555">{'Active: '}</text>
          <For each={chips()}>
            {(chip, index) => (
              <>
                <Show when={index() > 0}>
                  <text fg="#333333">{' '}</text>
                </Show>
                <text fg="#4ecca3" attributes={1}>
                  {`[${chip}]`}
                </text>
              </>
            )}
          </For>
        </box>
      </Show>

      {/* Key hints */}
      <box
        height={1}
        width="100%"
        flexDirection="row"
        paddingX={1}
        backgroundColor="#1a1a2e"
      >
        <text fg="#4ecca3" attributes={1}>{' [Enter] '}</text>
        <text fg="#aaaaaa">{'Apply'}</text>
        <text fg="#888888">{'  |  '}</text>
        <text fg="#cc8888" attributes={1}>{' [Esc] '}</text>
        <text fg="#aaaaaa">{'Clear & Close'}</text>
        <text fg="#888888">{'  |  '}</text>
        <text fg="#88aacc" attributes={1}>{' [Tab] '}</text>
        <text fg="#aaaaaa">{'Suggestions'}</text>
      </box>

      {/* Suggestions popup */}
      <Show when={showSuggestions() && filteredSuggestions().length > 0}>
        <box
          flexDirection="column"
          width="100%"
          backgroundColor="#1e1e2e"
          borderStyle="single"
          borderColor="#444466"
        >
          <box height={1} paddingX={1}>
            <text fg="#888888" attributes={1}>
              {'Suggestions (Tab to cycle, Enter to select)'}
            </text>
          </box>
          <For each={filteredSuggestions().slice(0, 10)}>
            {(suggestion, index) => (
              <box
                height={1}
                paddingX={1}
                backgroundColor={
                  index() === selectedSuggestion()
                    ? '#16213e'
                    : undefined
                }
              >
                <text
                  fg={
                    index() === selectedSuggestion()
                      ? '#ffffff'
                      : '#aaaaaa'
                  }
                  attributes={index() === selectedSuggestion() ? 1 : 0}
                >
                  {index() === selectedSuggestion() ? '> ' : '  '}
                  {suggestion}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  );
}
