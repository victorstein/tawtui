import { createSignal, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { CreateTaskDto } from '../../taskwarrior.types';

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
  '': { label: 'None', color: '#555555' },
  L: { label: 'Low', color: '#4ecca3' },
  M: { label: 'Medium', color: '#f0a500' },
  H: { label: 'High', color: '#e94560' },
};

export function TaskForm(props: TaskFormProps) {
  const [focusedField, setFocusedField] = createSignal<number>(0);
  const [description, setDescription] = createSignal(
    props.initialValues?.description ?? '',
  );
  const [project, setProject] = createSignal(
    props.initialValues?.project ?? '',
  );
  const [priority, setPriority] = createSignal<'' | 'L' | 'M' | 'H'>(
    props.initialValues?.priority ?? '',
  );
  const [tags, setTags] = createSignal(
    props.initialValues?.tags?.join(', ') ?? '',
  );
  const [due, setDue] = createSignal(props.initialValues?.due ?? '');

  const currentField = (): FieldName => FIELDS[focusedField()];

  const handleSubmit = () => {
    const desc = description().trim();
    if (!desc) return;

    const dto: CreateTaskDto = { description: desc };
    const proj = project().trim();
    if (proj) dto.project = proj;
    const pri = priority();
    if (pri) dto.priority = pri;
    const tagStr = tags().trim();
    if (tagStr) {
      dto.tags = tagStr
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    }
    const dueVal = due().trim();
    if (dueVal) dto.due = dueVal;

    props.onSubmit(dto);
  };

  const cyclePriority = () => {
    const current = priority();
    const idx = PRIORITY_CYCLE.indexOf(current);
    const next = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
    setPriority(next);
  };

  useKeyboard((key) => {
    if (key.name === 'tab' && !key.shift) {
      setFocusedField((prev) => (prev + 1) % FIELDS.length);
      return;
    }
    if (key.name === 'tab' && key.shift) {
      setFocusedField((prev) => (prev - 1 + FIELDS.length) % FIELDS.length);
      return;
    }
    if (key.name === 'return') {
      handleSubmit();
      return;
    }
    if (currentField() === 'priority' && key.name === 'p') {
      cyclePriority();
      return;
    }
  });

  const labelColor = (idx: number) =>
    focusedField() === idx ? '#ddddee' : '#888888';

  const priInfo = () => PRIORITY_DISPLAY[priority()] ?? PRIORITY_DISPLAY[''];

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <box height={1}>
        <text fg="#ddddee" attributes={1}>
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
          backgroundColor={focusedField() === 0 ? '#2a2a3e' : '#232335'}
          textColor="#ddddee"
          onInput={(val: string) => setDescription(val)}
        />
      </box>
      <box height={1} />

      {/* Project */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text fg={labelColor(1)} attributes={focusedField() === 1 ? 1 : 0}>
            {focusedField() === 1 ? '> ' : '  '}
            {FIELD_LABELS.project}
          </text>
        </box>
        <input
          width={60}
          value={project()}
          placeholder="e.g. work, personal"
          focused={focusedField() === 1}
          backgroundColor={focusedField() === 1 ? '#2a2a3e' : '#232335'}
          textColor="#ddddee"
          onInput={(val: string) => setProject(val)}
        />
      </box>
      <box height={1} />

      {/* Priority */}
      <box height={1} flexDirection="row">
        <box width={14}>
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
          <box
            height={1}
            backgroundColor="#2a2a3e"
            width={60}
            paddingX={1}
          >
            <text fg={priInfo().color} attributes={1}>
              {priInfo().label}
            </text>
            <text fg="#555555">{' - press [p] to cycle'}</text>
          </box>
        </Show>
      </box>
      <box height={1} />

      {/* Tags */}
      <box height={1} flexDirection="row">
        <box width={14}>
          <text fg={labelColor(3)} attributes={focusedField() === 3 ? 1 : 0}>
            {focusedField() === 3 ? '> ' : '  '}
            {FIELD_LABELS.tags}
          </text>
        </box>
        <input
          width={60}
          value={tags()}
          placeholder="comma-separated, e.g. bug, urgent"
          focused={focusedField() === 3}
          backgroundColor={focusedField() === 3 ? '#2a2a3e' : '#232335'}
          textColor="#ddddee"
          onInput={(val: string) => setTags(val)}
        />
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
          backgroundColor={focusedField() === 4 ? '#2a2a3e' : '#232335'}
          textColor="#ddddee"
          onInput={(val: string) => setDue(val)}
        />
      </box>

      {/* Spacer */}
      <box height={1} />

      {/* Validation hint */}
      <Show when={!description().trim()}>
        <box height={1}>
          <text fg="#e94560">{'  * Description is required'}</text>
        </box>
      </Show>

      {/* Key hints */}
      <box height={1} />
      <box height={1} flexDirection="row">
        <text fg="#88aacc" attributes={1}>{' [Tab] '}</text>
        <text fg="#aaaaaa">{'Next field  '}</text>
        <text fg="#4ecca3" attributes={1}>{' [Enter] '}</text>
        <text fg="#aaaaaa">{'Save  '}</text>
        <text fg="#cc8888" attributes={1}>{' [Esc] '}</text>
        <text fg="#aaaaaa">{'Cancel'}</text>
      </box>
    </box>
  );
}
