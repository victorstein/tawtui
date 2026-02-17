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
  ACCENT_PRIMARY,
  COLOR_ERROR,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
} from '../theme';
import { darkenHex, lerpHex, ALLOWED_TAGS, getTagGradient } from '../utils';

const FORM_BUTTONS = [
  {
    label: ' [Enter] Save ',
    shortcut: 'return',
    gradStart: '#5aaa6a',
    gradEnd: '#2a7a8a',
  },
  {
    label: ' [Esc] Cancel ',
    shortcut: 'escape',
    gradStart: '#e05555',
    gradEnd: '#8a2a2a',
  },
] as const;

interface TaskFormProps {
  mode: 'create' | 'edit';
  initialValues?: Partial<CreateTaskDto> & { parent?: string };
  onSubmit: (dto: CreateTaskDto) => void;
  onCancel: () => void;
  onStopRecurrence?: (parentUuid: string) => void;
}

const FIELDS = [
  'description',
  'annotation',
  'project',
  'priority',
  'tags',
  'due',
  'recur',
] as const;
type FieldName = (typeof FIELDS)[number];

const FIELD_LABELS: Record<FieldName, string> = {
  description: 'Title',
  annotation: 'Description',
  project: 'Project',
  priority: 'Priority',
  tags: 'Tags',
  due: 'Due',
  recur: 'Recurrence',
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
    'project' | 'recur' | null
  >(null);
  const [newInputValue, setNewInputValue] = createSignal('');

  // Predefined recurrence options
  const RECURRENCE_OPTIONS = [
    'daily',
    'weekdays',
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'semiannual',
    'yearly',
  ];

  const [availableRecurrences, setAvailableRecurrences] =
    createSignal<string[]>(RECURRENCE_OPTIONS);
  const [selectedRecurrence, setSelectedRecurrence] = createSignal<
    string | null
  >(props.initialValues?.recur ?? null);
  const [recurrenceCursor, setRecurrenceCursor] = createSignal(0);

  const initialRecur = props.initialValues?.recur ?? null;

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
      const projects = await (tw.getProjects() as Promise<string[]>);
      setAvailableTags([...ALLOWED_TAGS]);
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
      // Initialize recurrence cursor
      if (props.initialValues?.recur) {
        const recur = props.initialValues.recur;
        if (!RECURRENCE_OPTIONS.includes(recur)) {
          setAvailableRecurrences((prev) => [recur, ...prev]);
        }
        const idx = availableRecurrences().indexOf(recur);
        if (idx >= 0) setRecurrenceCursor(idx);
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
    } else if (newInputMode() === 'recur') {
      let newRecurrences = availableRecurrences();
      if (!newRecurrences.includes(val)) {
        newRecurrences = [...newRecurrences, val];
        setAvailableRecurrences(newRecurrences);
      }
      setSelectedRecurrence(val);
      const idx = newRecurrences.indexOf(val);
      if (idx >= 0) setRecurrenceCursor(idx);
    }
    setNewInputMode(null);
    setNewInputValue('');
  };

  const handleSubmit = () => {
    const desc = description().trim();
    if (!desc) return;

    const dto: CreateTaskDto = { description: desc };
    const ann = annotation().trim();
    const proj = allProjects()[projectIndex()] ?? '';
    const pri = priority();
    const tagArr = [...selectedTags()];
    const dueVal = due().trim();

    if (props.mode === 'edit') {
      dto.annotation = ann;
      dto.project = proj;
      dto.priority = pri || undefined;
      dto.tags = tagArr;
      dto.due = dueVal;
    } else {
      if (ann) dto.annotation = ann;
      if (proj) dto.project = proj;
      if (pri) dto.priority = pri;
      if (tagArr.length > 0) dto.tags = tagArr;
      if (dueVal) dto.due = dueVal;
    }

    // Validate: recur requires due date
    const recurVal = selectedRecurrence();
    if (recurVal && !due().trim()) return;

    if (recurVal) dto.recur = recurVal;

    // If recurrence was removed on a child task, stop the parent
    if (initialRecur && !recurVal && props.initialValues?.parent) {
      props.onStopRecurrence?.(props.initialValues.parent);
    }

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
    }

    // Recurrence single-select
    if (currentField() === 'recur') {
      const recurrences = availableRecurrences();
      if (key.name === 'left' && recurrences.length > 0) {
        key.preventDefault();
        setRecurrenceCursor(
          (c) => (c - 1 + recurrences.length) % recurrences.length,
        );
        return;
      }
      if (key.name === 'right' && recurrences.length > 0) {
        key.preventDefault();
        setRecurrenceCursor((c) => (c + 1) % recurrences.length);
        return;
      }
      if (key.name === 'space' && recurrences.length > 0) {
        key.preventDefault();
        const cursor = Math.min(recurrenceCursor(), recurrences.length - 1);
        const recur = recurrences[cursor];
        setSelectedRecurrence((prev) => (prev === recur ? null : recur));
        return;
      }
      if (key.name === 'n') {
        key.preventDefault();
        setNewInputMode('recur');
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
    return sel.length > 0 ? sel.map((t) => t.toUpperCase()).join(', ') : 'None';
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
          ref={(el: any) => {
            annotationRef = el;
          }}
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
              <text fg={allProjects()[projectIndex()] ? PROJECT_COLOR : FG_DIM}>
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
                    fg={allProjects()[projectIndex()] ? PROJECT_COLOR : FG_DIM}
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
            <box>
              <text fg={selectedTags().size > 0 ? FG_NORMAL : FG_DIM}>
                {selectedTagsDisplay()}
              </text>
            </box>
          }
        >
          <box flexDirection="column" width={60}>
            <box
              height={1}
              backgroundColor={BG_INPUT_FOCUS}
              paddingX={1}
              flexDirection="row"
            >
              <Show
                when={allTags().length > 0}
                fallback={<text fg={FG_DIM}>{'None'}</text>}
              >
                {(() => {
                  const cursor = () =>
                    Math.min(tagCursor(), allTags().length - 1);
                  const tag = () => allTags()[cursor()];
                  const isSelected = () => selectedTags().has(tag());
                  const color = () => getTagGradient(tag()).start;
                  const selectedCount = () =>
                    [...allTags()].filter((t) => selectedTags().has(t)).length;
                  return (
                    <>
                      <text fg={color()} attributes={1}>
                        {'▸ '}
                        {isSelected() ? '●' : '○'} {tag().toUpperCase()}
                      </text>
                      <box flexGrow={1} />
                      <text fg={FG_DIM}>
                        {selectedCount()}
                        {' of '}
                        {allTags().length}
                        {' selected'}
                      </text>
                    </>
                  );
                })()}
              </Show>
            </box>
            <Show when={allTags().length > 0}>
              <box height={1} paddingX={1}>
                <text fg={FG_DIM}>{'[←/→] move  [space] toggle'}</text>
              </box>
            </Show>
          </box>
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
      <box height={1} />

      {/* Recurrence */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(6)} attributes={isFieldFocused(6) ? 1 : 0}>
            {isFieldFocused(6) ? '> ' : '  '}
            {FIELD_LABELS.recur}
          </text>
        </box>
        <Show
          when={isFieldFocused(6)}
          fallback={
            <box height={1}>
              <text fg={selectedRecurrence() ? FG_NORMAL : FG_DIM}>
                {selectedRecurrence() ?? 'None'}
              </text>
            </box>
          }
        >
          <Show
            when={newInputMode() === 'recur'}
            fallback={
              <box flexDirection="column" width={60}>
                <box
                  height={1}
                  backgroundColor={BG_INPUT_FOCUS}
                  paddingX={1}
                  flexDirection="row"
                >
                  <Show
                    when={availableRecurrences().length > 0}
                    fallback={<text fg={FG_DIM}>{'None  [n] add custom'}</text>}
                  >
                    {(() => {
                      const cursor = () =>
                        Math.min(
                          recurrenceCursor(),
                          availableRecurrences().length - 1,
                        );
                      const recur = () => availableRecurrences()[cursor()];
                      const isSelected = () => selectedRecurrence() === recur();
                      return (
                        <>
                          <text
                            fg={isSelected() ? ACCENT_PRIMARY : FG_NORMAL}
                            attributes={1}
                          >
                            {'▸ '}
                            {isSelected() ? '●' : '○'} {recur()}
                          </text>
                          <box flexGrow={1} />
                          <text fg={FG_DIM}>
                            {cursor() + 1}
                            {' of '}
                            {availableRecurrences().length}
                          </text>
                        </>
                      );
                    })()}
                  </Show>
                </box>
                <box height={1} paddingX={1}>
                  <text fg={FG_DIM}>
                    {props.initialValues?.parent
                      ? '[←/→] move  [space] select  [n] custom  (deselect to stop)'
                      : '[←/→] move  [space] select  [n] custom'}
                  </text>
                </box>
              </box>
            }
          >
            <input
              width={60}
              value={newInputValue()}
              placeholder="e.g., 2weeks, 3months, P14D"
              focused={true}
              backgroundColor={BG_INPUT_FOCUS}
              textColor={FG_NORMAL}
              onInput={(val: string) => setNewInputValue(val)}
            />
          </Show>
        </Show>
      </box>
      <box height={1} />

      {/* Spacer */}
      <box height={1} />

      {/* Validation hint */}
      <Show when={!description().trim()}>
        <box height={1}>
          <text fg={COLOR_ERROR}>{'  * Title is required'}</text>
        </box>
      </Show>
      <Show when={selectedRecurrence() && !due().trim()}>
        <box height={1}>
          <text fg={COLOR_ERROR}>
            {'  * Due date required for recurring tasks'}
          </text>
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
