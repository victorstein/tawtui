import { createSignal, Show, onMount, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { CreateTaskDto } from '../../taskwarrior.types';
import {
  BG_INPUT,
  BG_INPUT_FOCUS,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  FG_MUTED,
  COLOR_ERROR,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
  TAG_COLORS,
} from '../theme';

function darkenHex(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function lerpHex(a: string, b: string, t: number): string {
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

const FORM_BUTTONS = [
  { label: ' [Enter] Save ', shortcut: 'return', gradStart: '#5aaa6a', gradEnd: '#2a7a8a' },
  { label: ' [Esc] Cancel ', shortcut: 'escape', gradStart: '#e05555', gradEnd: '#8a2a2a' },
] as const;

interface TaskFormProps {
  mode: 'create' | 'edit';
  initialValues?: Partial<CreateTaskDto>;
  onSubmit: (dto: CreateTaskDto) => void;
  onCancel: () => void;
}

const FIELDS = [
  'description',
  'annotation',
  'project',
  'priority',
  'tags',
  'due',
] as const;
type FieldName = (typeof FIELDS)[number];

const FIELD_LABELS: Record<FieldName, string> = {
  description: 'Title',
  annotation: 'Description',
  project: 'Project',
  priority: 'Priority',
  tags: 'Tags',
  due: 'Due',
};

const PRIORITY_CYCLE: ('' | 'L' | 'M' | 'H')[] = ['', 'L', 'M', 'H'];

const PRIORITY_DISPLAY: Record<string, { label: string; color: string }> = {
  '': { label: 'None', color: FG_DIM },
  L: { label: 'Low', color: PRIORITY_L },
  M: { label: 'Medium', color: PRIORITY_M },
  H: { label: 'High', color: PRIORITY_H },
};

export function TaskForm(props: TaskFormProps) {
  const [focusedField, setFocusedField] = createSignal<number>(0);
  const [description, setDescription] = createSignal(
    props.initialValues?.description ?? '',
  );
  const [annotation, setAnnotation] = createSignal(
    props.initialValues?.annotation ?? '',
  );
  // Ref to the textarea renderable so we can read plainText on content change
  // (OpenTUI's onContentChange passes an empty object, not the text content)
  let annotationRef: any = null;
  const [priority, setPriority] = createSignal<'' | 'L' | 'M' | 'H'>(
    props.initialValues?.priority ?? '',
  );
  const [due, setDue] = createSignal(props.initialValues?.due ?? '');

  // Project cycling state
  const [availableProjects, setAvailableProjects] = createSignal<string[]>([]);
  const [projectIndex, setProjectIndex] = createSignal(0);

  // Tags multi-select state
  const [availableTags, setAvailableTags] = createSignal<string[]>([]);
  const [selectedTags, setSelectedTags] = createSignal<Set<string>>(
    new Set(props.initialValues?.tags ?? []),
  );
  const [tagCursor, setTagCursor] = createSignal(0);

  // Button row focus: null means focus is on a form field, number is button index
  const [buttonFocus, setButtonFocus] = createSignal<number | null>(null);

  // New input mode for inline creation
  const [newInputMode, setNewInputMode] = createSignal<
    'project' | 'tags' | null
  >(null);
  const [newInputValue, setNewInputValue] = createSignal('');

  // Derived merged lists
  const allProjects = (): string[] => {
    const initial = props.initialValues?.project
      ? [props.initialValues.project]
      : [];
    return ['', ...new Set([...availableProjects(), ...initial])];
  };

  const allTags = (): string[] => {
    const initial = props.initialValues?.tags ?? [];
    return [...new Set([...availableTags(), ...initial])];
  };

  // Load data on mount
  onMount(async () => {
    const tw = (globalThis as any).__tawtui?.taskwarriorService;
    if (!tw) return;
    try {
      const [tags, projects] = await Promise.all([
        tw.getTags() as Promise<string[]>,
        tw.getProjects() as Promise<string[]>,
      ]);
      setAvailableTags(tags);
      setAvailableProjects(projects);
      // Set initial project index
      if (props.initialValues?.project) {
        const all = [
          '',
          ...new Set([...projects, props.initialValues.project]),
        ];
        const idx = all.indexOf(props.initialValues.project);
        if (idx >= 0) setProjectIndex(idx);
      }
    } catch {
      // Silently fail — will show empty lists
    }
  });

  const currentField = (): FieldName => FIELDS[focusedField()];

  const commitNewInput = () => {
    const val = newInputValue().trim();
    if (!val) {
      setNewInputMode(null);
      setNewInputValue('');
      return;
    }
    if (newInputMode() === 'project') {
      if (!availableProjects().includes(val)) {
        setAvailableProjects((prev) => [...prev, val]);
      }
      const newAll = ['', ...new Set([...availableProjects(), val])];
      setProjectIndex(newAll.indexOf(val));
    } else if (newInputMode() === 'tags') {
      if (!availableTags().includes(val)) {
        setAvailableTags((prev) => [...prev, val]);
      }
      setSelectedTags((prev) => new Set([...prev, val]));
    }
    setNewInputMode(null);
    setNewInputValue('');
  };

  const handleSubmit = () => {
    const desc = description().trim();
    if (!desc) return;

    const dto: CreateTaskDto = { description: desc };
    const ann = annotation().trim();
    if (ann) dto.annotation = ann;
    const proj = allProjects()[projectIndex()];
    if (proj) dto.project = proj;
    const pri = priority();
    if (pri) dto.priority = pri;
    const tagArr = [...selectedTags()];
    if (tagArr.length > 0) dto.tags = tagArr;
    const dueVal = due().trim();
    if (dueVal) dto.due = dueVal;

    props.onSubmit(dto);
  };

  useKeyboard((key) => {
    // When in new input mode, only handle Escape and Return
    if (newInputMode() !== null) {
      if (key.name === 'escape') {
        key.preventDefault();
        setNewInputMode(null);
        setNewInputValue('');
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        commitNewInput();
        return;
      }
      return; // Let input handle all other keys
    }

    // Escape always cancels
    if (key.name === 'escape') {
      key.preventDefault();
      key.stopPropagation();
      props.onCancel();
      return;
    }

    // Button row focus handling
    if (buttonFocus() !== null) {
      if (key.name === 'left') {
        key.preventDefault();
        key.stopPropagation();
        setButtonFocus((prev) =>
          prev !== null
            ? (prev - 1 + FORM_BUTTONS.length) % FORM_BUTTONS.length
            : 0,
        );
        return;
      }
      if (key.name === 'right') {
        key.preventDefault();
        key.stopPropagation();
        setButtonFocus((prev) =>
          prev !== null ? (prev + 1) % FORM_BUTTONS.length : 0,
        );
        return;
      }
      if (key.name === 'tab' && !key.shift) {
        key.preventDefault();
        key.stopPropagation();
        if (buttonFocus()! < FORM_BUTTONS.length - 1) {
          setButtonFocus((prev) => prev! + 1);
        } else {
          setButtonFocus(null);
          setFocusedField(0);
        }
        return;
      }
      if (key.name === 'tab' && key.shift) {
        key.preventDefault();
        key.stopPropagation();
        if (buttonFocus()! > 0) {
          setButtonFocus((prev) => prev! - 1);
        } else {
          setButtonFocus(null);
          setFocusedField(FIELDS.length - 1);
        }
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        key.stopPropagation();
        const btn = FORM_BUTTONS[buttonFocus()!];
        if (btn.shortcut === 'return') handleSubmit();
        if (btn.shortcut === 'escape') props.onCancel();
        return;
      }
      key.stopPropagation();
      return;
    }

    // Form field navigation
    if (key.name === 'tab' && !key.shift) {
      key.preventDefault();
      key.stopPropagation();
      if (focusedField() === FIELDS.length - 1) {
        setButtonFocus(0);
      } else {
        setFocusedField((prev) => prev + 1);
      }
      return;
    }
    if (key.name === 'tab' && key.shift) {
      key.preventDefault();
      key.stopPropagation();
      if (focusedField() === 0) {
        setButtonFocus(FORM_BUTTONS.length - 1);
      } else {
        setFocusedField((prev) => prev - 1);
      }
      return;
    }

    // Priority cycling
    if (currentField() === 'priority') {
      if (key.name === 'left') {
        key.preventDefault();
        setPriority((cur) => {
          const idx = PRIORITY_CYCLE.indexOf(cur);
          return PRIORITY_CYCLE[
            (idx - 1 + PRIORITY_CYCLE.length) % PRIORITY_CYCLE.length
          ];
        });
        return;
      }
      if (key.name === 'right') {
        key.preventDefault();
        setPriority((cur) => {
          const idx = PRIORITY_CYCLE.indexOf(cur);
          return PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
        });
        return;
      }
    }

    // Project cycling
    if (currentField() === 'project') {
      if (key.name === 'left') {
        key.preventDefault();
        setProjectIndex(
          (i) => (i - 1 + allProjects().length) % allProjects().length,
        );
        return;
      }
      if (key.name === 'right') {
        key.preventDefault();
        setProjectIndex((i) => (i + 1) % allProjects().length);
        return;
      }
      if (key.name === 'n') {
        key.preventDefault();
        setNewInputMode('project');
        setNewInputValue('');
        return;
      }
    }

    // Tags multi-select
    if (currentField() === 'tags') {
      const tags = allTags();
      if (key.name === 'left' && tags.length > 0) {
        key.preventDefault();
        setTagCursor((c) => (c - 1 + tags.length) % tags.length);
        return;
      }
      if (key.name === 'right' && tags.length > 0) {
        key.preventDefault();
        setTagCursor((c) => (c + 1) % tags.length);
        return;
      }
      if (key.name === 'space' && tags.length > 0) {
        key.preventDefault();
        const cursor = Math.min(tagCursor(), tags.length - 1);
        const tag = tags[cursor];
        setSelectedTags((prev) => {
          const next = new Set(prev);
          if (next.has(tag)) {
            next.delete(tag);
          } else {
            next.add(tag);
          }
          return next;
        });
        return;
      }
      if (key.name === 'n') {
        key.preventDefault();
        setNewInputMode('tags');
        setNewInputValue('');
        return;
      }
    }
  });

  const labelColor = (idx: number) =>
    buttonFocus() === null && focusedField() === idx ? FG_NORMAL : FG_DIM;

  const isFieldFocused = (idx: number) =>
    buttonFocus() === null && focusedField() === idx;

  const priInfo = () => PRIORITY_DISPLAY[priority()] ?? PRIORITY_DISPLAY[''];

  const projectDisplayName = () => {
    const proj = allProjects()[projectIndex()];
    return proj || 'None';
  };

  const selectedTagsDisplay = () => {
    const sel = [...selectedTags()];
    return sel.length > 0 ? sel.join(', ') : 'None';
  };

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <box height={1}>
        <text fg={FG_PRIMARY} attributes={1}>
          {props.mode === 'create' ? 'New Task' : 'Edit Task'}
        </text>
      </box>
      <box height={1} />

      {/* Description */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text fg={labelColor(0)} attributes={isFieldFocused(0) ? 1 : 0}>
            {isFieldFocused(0) ? '> ' : '  '}
            {FIELD_LABELS.description}
          </text>
        </box>
        <input
            width={60}
            value={description()}
            placeholder="Task title (required)"
            focused={isFieldFocused(0)}
            backgroundColor={isFieldFocused(0) ? BG_INPUT_FOCUS : BG_INPUT}
            textColor={FG_NORMAL}
            onInput={(val: string) => setDescription(val)}
          />
      </box>
      <box height={1} />

      {/* Body / Notes */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(1)} attributes={isFieldFocused(1) ? 1 : 0}>
            {isFieldFocused(1) ? '> ' : '  '}
            {FIELD_LABELS.annotation}
          </text>
        </box>
        <textarea
          ref={(el: any) => { annotationRef = el; }}
          width={60}
          height={5}
          initialValue={annotation()}
          placeholder="Optional notes or body text (supports markdown)"
          placeholderColor={FG_DIM}
          focused={isFieldFocused(1)}
          backgroundColor={isFieldFocused(1) ? BG_INPUT_FOCUS : BG_INPUT}
          focusedBackgroundColor={BG_INPUT_FOCUS}
          focusedTextColor={FG_NORMAL}
          textColor={FG_NORMAL}
          onContentChange={() => {
            if (annotationRef) {
              setAnnotation(annotationRef.plainText ?? '');
            }
          }}
        />
      </box>
      <box height={1} />

      {/* Project */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(2)} attributes={isFieldFocused(2) ? 1 : 0}>
            {isFieldFocused(2) ? '> ' : '  '}
            {FIELD_LABELS.project}
          </text>
        </box>
        <Show
          when={isFieldFocused(2)}
          fallback={
            <box height={1}>
              <text
                fg={allProjects()[projectIndex()] ? PROJECT_COLOR : FG_DIM}
              >
                {projectDisplayName()}
              </text>
            </box>
          }
        >
          <Show
            when={newInputMode() === 'project'}
            fallback={
              <box flexDirection="column" width={60}>
                <box height={1} backgroundColor={BG_INPUT_FOCUS} paddingX={1}>
                  <text
                    fg={
                      allProjects()[projectIndex()] ? PROJECT_COLOR : FG_DIM
                    }
                    attributes={1}
                  >
                    {projectDisplayName()}
                  </text>
                </box>
                <box height={1} paddingX={1}>
                  <text fg={FG_DIM}>{'[←/→] cycle  [n] new'}</text>
                </box>
              </box>
            }
          >
            <input
              width={60}
              value={newInputValue()}
              placeholder="New project name"
              focused={true}
              backgroundColor={BG_INPUT_FOCUS}
              textColor={FG_NORMAL}
              onInput={(val: string) => setNewInputValue(val)}
            />
          </Show>
        </Show>
      </box>
      <box height={1} />

      {/* Priority */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(3)} attributes={isFieldFocused(3) ? 1 : 0}>
            {isFieldFocused(3) ? '> ' : '  '}
            {FIELD_LABELS.priority}
          </text>
        </box>
        <Show
          when={isFieldFocused(3)}
          fallback={
            <box height={1}>
              <text fg={priInfo().color}>{priInfo().label}</text>
            </box>
          }
        >
          <box flexDirection="column" width={60}>
            <box height={1} backgroundColor={BG_INPUT_FOCUS} paddingX={1}>
              <text fg={priInfo().color} attributes={1}>
                {priInfo().label}
              </text>
            </box>
            <box height={1} paddingX={1}>
              <text fg={FG_DIM}>{'[←/→] cycle'}</text>
            </box>
          </box>
        </Show>
      </box>
      <box height={1} />

      {/* Tags */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(4)} attributes={isFieldFocused(4) ? 1 : 0}>
            {isFieldFocused(4) ? '> ' : '  '}
            {FIELD_LABELS.tags}
          </text>
        </box>
        <Show
          when={isFieldFocused(4)}
          fallback={
            <box height={1}>
              <text fg={selectedTags().size > 0 ? FG_NORMAL : FG_DIM}>
                {selectedTagsDisplay()}
              </text>
            </box>
          }
        >
          <Show
            when={newInputMode() === 'tags'}
            fallback={
              <box flexDirection="column" width={60}>
                <box
                  height={1}
                  backgroundColor={BG_INPUT_FOCUS}
                  paddingX={1}
                  flexDirection="row"
                >
                  <Show
                    when={allTags().length > 0}
                    fallback={
                      <text fg={FG_DIM}>{'None  [n] add new'}</text>
                    }
                  >
                    {(() => {
                      const cursor = () =>
                        Math.min(tagCursor(), allTags().length - 1);
                      const tag = () => allTags()[cursor()];
                      const isSelected = () => selectedTags().has(tag());
                      const color = () =>
                        TAG_COLORS[cursor() % TAG_COLORS.length];
                      const selectedCount = () =>
                        [...allTags()].filter((t) => selectedTags().has(t)).length;
                      return (
                        <>
                          <text fg={color()} attributes={1}>
                            {'▸ '}
                            {isSelected() ? '●' : '○'}{' '}
                            {tag()}
                          </text>
                          <box flexGrow={1} />
                          <text fg={FG_DIM}>
                            {selectedCount()}{' of '}{allTags().length}{' selected'}
                          </text>
                        </>
                      );
                    })()}
                  </Show>
                </box>
                <Show when={allTags().length > 0}>
                  <box height={1} paddingX={1}>
                    <text fg={FG_DIM}>
                      {'[←/→] move  [space] toggle  [n] new'}
                    </text>
                  </box>
                </Show>
              </box>
            }
          >
            <input
              width={60}
              value={newInputValue()}
              placeholder="New tag name"
              focused={true}
              backgroundColor={BG_INPUT_FOCUS}
              textColor={FG_NORMAL}
              onInput={(val: string) => setNewInputValue(val)}
            />
          </Show>
        </Show>
      </box>
      <box height={1} />

      {/* Due */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text fg={labelColor(5)} attributes={isFieldFocused(5) ? 1 : 0}>
            {isFieldFocused(5) ? '> ' : '  '}
            {FIELD_LABELS.due}
          </text>
        </box>
        <input
            width={60}
            value={due()}
            placeholder="e.g. tomorrow, eow, 2026-03-01"
            focused={isFieldFocused(5)}
            backgroundColor={isFieldFocused(5) ? BG_INPUT_FOCUS : BG_INPUT}
            textColor={FG_NORMAL}
            onInput={(val: string) => setDue(val)}
          />
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Validation hint */}
      <Show when={!description().trim()}>
        <box height={1}>
          <text fg={COLOR_ERROR}>{'  * Title is required'}</text>
        </box>
      </Show>

      {/* Action buttons */}
      <box height={1} />
      <box height={1} marginLeft={-2}>
        <text fg={FG_MUTED}>{'[Tab] Next field'}</text>
      </box>
      <box height={1} />
      <box height={1} flexDirection="row">
        <For each={[...FORM_BUTTONS]}>
          {(btn, idx) => {
            const isFocused = () => buttonFocus() === idx();
            const chars = btn.label.split('');
            const dimBg = darkenHex(btn.gradStart, 0.3);
            return (
              <>
                {idx() > 0 && <text>{'  '}</text>}
                <box flexDirection="row">
                  {isFocused() ? (
                    <>
                      <text fg={btn.gradStart}>{'\uE0B6'}</text>
                      <For each={chars}>
                        {(char, i) => {
                          const t =
                            chars.length > 1 ? i() / (chars.length - 1) : 0;
                          return (
                            <text
                              fg="#ffffff"
                              bg={lerpHex(btn.gradStart, btn.gradEnd, t)}
                              attributes={1}
                            >
                              {char}
                            </text>
                          );
                        }}
                      </For>
                      <text fg={btn.gradEnd}>{'\uE0B4'}</text>
                    </>
                  ) : (
                    <>
                      <text fg={dimBg}>{'\uE0B6'}</text>
                      <text fg={btn.gradStart} bg={dimBg}>
                        {btn.label}
                      </text>
                      <text fg={dimBg}>{'\uE0B4'}</text>
                    </>
                  )}
                </box>
              </>
            );
          }}
        </For>
      </box>
    </box>
  );
}
