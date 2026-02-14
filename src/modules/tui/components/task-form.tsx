import { createSignal, Show, onMount } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { CreateTaskDto } from '../../taskwarrior.types';
import {
  BG_INPUT,
  BG_INPUT_FOCUS,
  FG_PRIMARY,
  FG_NORMAL,
  FG_DIM,
  ACCENT_PRIMARY,
  ACCENT_TERTIARY,
  COLOR_ERROR,
  COLOR_SUCCESS,
  PRIORITY_H,
  PRIORITY_M,
  PRIORITY_L,
  PROJECT_COLOR,
  TAG_COLORS,
} from '../theme';

interface TaskFormProps {
  mode: 'create' | 'edit';
  initialValues?: Partial<CreateTaskDto>;
  onSubmit: (dto: CreateTaskDto) => void;
  onCancel: () => void;
}

const FIELDS = ['description', 'project', 'priority', 'tags', 'due'] as const;
type FieldName = (typeof FIELDS)[number];

const FIELD_LABELS: Record<FieldName, string> = {
  description: 'Description',
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

    if (key.name === 'tab' && !key.shift) {
      key.preventDefault();
      setFocusedField((prev) => (prev + 1) % FIELDS.length);
      return;
    }
    if (key.name === 'tab' && key.shift) {
      key.preventDefault();
      setFocusedField((prev) => (prev - 1 + FIELDS.length) % FIELDS.length);
      return;
    }
    if (key.name === 'return') {
      key.preventDefault();
      handleSubmit();
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
    focusedField() === idx ? FG_NORMAL : FG_DIM;

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
          <text fg={labelColor(0)} attributes={focusedField() === 0 ? 1 : 0}>
            {focusedField() === 0 ? '> ' : '  '}
            {FIELD_LABELS.description}
          </text>
        </box>
        <input
          width={60}
          value={description()}
          placeholder="Task description (required)"
          focused={focusedField() === 0}
          backgroundColor={focusedField() === 0 ? BG_INPUT_FOCUS : BG_INPUT}
          textColor={FG_NORMAL}
          onInput={(val: string) => setDescription(val)}
        />
      </box>
      <box height={1} />

      {/* Project */}
      <box flexDirection="row">
        <box width={14} height={1}>
          <text fg={labelColor(1)} attributes={focusedField() === 1 ? 1 : 0}>
            {focusedField() === 1 ? '> ' : '  '}
            {FIELD_LABELS.project}
          </text>
        </box>
        <Show
          when={focusedField() === 1}
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
          <text fg={labelColor(2)} attributes={focusedField() === 2 ? 1 : 0}>
            {focusedField() === 2 ? '> ' : '  '}
            {FIELD_LABELS.priority}
          </text>
        </box>
        <Show
          when={focusedField() === 2}
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
          <text fg={labelColor(3)} attributes={focusedField() === 3 ? 1 : 0}>
            {focusedField() === 3 ? '> ' : '  '}
            {FIELD_LABELS.tags}
          </text>
        </box>
        <Show
          when={focusedField() === 3}
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
          <text fg={labelColor(4)} attributes={focusedField() === 4 ? 1 : 0}>
            {focusedField() === 4 ? '> ' : '  '}
            {FIELD_LABELS.due}
          </text>
        </box>
        <input
          width={60}
          value={due()}
          placeholder="e.g. tomorrow, eow, 2026-03-01"
          focused={focusedField() === 4}
          backgroundColor={focusedField() === 4 ? BG_INPUT_FOCUS : BG_INPUT}
          textColor={FG_NORMAL}
          onInput={(val: string) => setDue(val)}
        />
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Validation hint */}
      <Show when={!description().trim()}>
        <box height={1}>
          <text fg={COLOR_ERROR}>{'  * Description is required'}</text>
        </box>
      </Show>

      {/* Key hints */}
      <box height={1} />
      <box height={1} flexDirection="row">
        <text fg={ACCENT_TERTIARY} attributes={1}>{' [Tab] '}</text>
        <text fg={FG_DIM}>{'Next field  '}</text>
        <text fg={COLOR_SUCCESS} attributes={1}>{' [Enter] '}</text>
        <text fg={FG_DIM}>{'Save  '}</text>
        <text fg={ACCENT_PRIMARY} attributes={1}>{' [Esc] '}</text>
        <text fg={FG_DIM}>{'Cancel'}</text>
      </box>
    </box>
  );
}
