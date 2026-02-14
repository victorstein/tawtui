export interface Task {
  uuid: string;
  id?: number; // volatile working-set ID
  status: 'pending' | 'completed' | 'deleted' | 'waiting' | 'recurring';
  description: string;
  project?: string;
  priority?: 'H' | 'M' | 'L';
  tags?: string[];
  due?: string;
  scheduled?: string;
  wait?: string;
  recur?: string;
  until?: string;
  depends?: string; // comma-separated UUIDs
  start?: string;
  end?: string;
  entry?: string;
  modified?: string;
  urgency?: number;
  annotations?: Array<{ entry: string; description: string }>;
  parent?: string; // for recurring task instances
  mask?: string;
  imask?: number;
  [key: string]: unknown; // preserve UDAs
}

export interface CreateTaskDto {
  description: string;
  project?: string;
  priority?: 'H' | 'M' | 'L';
  tags?: string[];
  due?: string;
  scheduled?: string;
  recur?: string;
  depends?: string;
}

export interface UpdateTaskDto extends Partial<CreateTaskDto> {}
