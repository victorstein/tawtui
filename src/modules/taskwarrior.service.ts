import { Injectable, Logger } from '@nestjs/common';
import type { Task, CreateTaskDto, UpdateTaskDto } from './taskwarrior.types';
import type { ExecResult } from '../shared/types';

@Injectable()
export class TaskwarriorService {
  private readonly logger = new Logger(TaskwarriorService.name);

  private readonly rcOverrides = [
    'rc.confirmation=off',
    'rc.bulk=0',
    'rc.verbose=nothing',
    'rc.color=off',
    'rc.json.array=on',
  ];

  /**
   * Execute `task` with common RC overrides and the given arguments.
   * Uses Bun.spawnSync() for synchronous execution.
   */
  private execTask(args: string[], stdin?: string): ExecResult {
    const cmd = ['task', ...this.rcOverrides, ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')}`);

    const proc = Bun.spawnSync(cmd, {
      stdin: stdin != null ? Buffer.from(stdin) : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: process.env.HOME ?? '' },
    });

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    const exitCode = proc.exitCode;

    if (exitCode !== 0) {
      this.logger.warn(
        `task exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
      );
    }

    return { stdout, stderr, exitCode };
  }

  /**
   * Retrieve tasks matching an optional filter string.
   * Runs: task <rc-overrides> [filter] export
   */
  async getTasks(filter?: string): Promise<Task[]> {
    const args: string[] = [];
    if (filter) {
      args.push(...filter.split(/\s+/));
    }
    args.push('export');

    const { stdout, stderr, exitCode } = this.execTask(args);

    // Exit code 1 = "no matching tasks" — not an error, just empty.
    // Only treat exit codes >= 2 as real failures.
    if (exitCode > 1) {
      this.logger.warn(
        `task export failed (exit ${exitCode}): ${stderr.trim()}`,
      );
      return [];
    }

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '[]') {
      return [];
    }

    try {
      return JSON.parse(trimmed) as Task[];
    } catch (err) {
      this.logger.warn(
        `Failed to parse task export JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Retrieve a single task by UUID.
   * Returns null if the task is not found.
   */
  async getTask(uuid: string): Promise<Task | null> {
    const args = [uuid, 'export'];
    const { stdout, exitCode } = this.execTask(args);

    if (exitCode !== 0) {
      return null;
    }

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '[]') {
      return null;
    }

    try {
      const tasks = JSON.parse(trimmed) as Task[];
      return tasks.length > 0 ? tasks[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a new task by piping JSON to `task import`.
   * Returns the newly created task.
   */
  async createTask(dto: CreateTaskDto): Promise<Task> {
    const payload: Record<string, unknown> = {
      description: dto.description,
      status: 'pending',
    };

    if (dto.project) payload.project = dto.project;
    if (dto.priority) payload.priority = dto.priority;
    if (dto.tags && dto.tags.length > 0) payload.tags = dto.tags;
    if (dto.due) payload.due = dto.due;
    if (dto.scheduled) payload.scheduled = dto.scheduled;
    if (dto.recur) payload.recur = dto.recur;
    if (dto.depends) payload.depends = dto.depends;

    const json = JSON.stringify(payload);
    const { stdout, stderr, exitCode } = this.execTask(['import'], json);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to create task (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
      );
    }

    // `task import` output typically contains the UUID of the imported task.
    // Extract UUID from output like "Importing task <uuid>." or similar.
    const uuidMatch = stdout.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );

    if (uuidMatch) {
      if (dto.annotation) {
        await this.addAnnotation(uuidMatch[1], dto.annotation);
      }
      const created = await this.getTask(uuidMatch[1]);
      if (created) return created;
    }

    // Fallback: try to find the task by description if UUID extraction failed
    const tasks = await this.getTasks(`description:${dto.description}`);
    if (tasks.length > 0) {
      // Return the most recently entered one
      const task = tasks.sort((a, b) => {
        const aEntry = a.entry ?? '';
        const bEntry = b.entry ?? '';
        return bEntry.localeCompare(aEntry);
      })[0];

      if (dto.annotation) {
        await this.addAnnotation(task.uuid, dto.annotation);
        const refreshed = await this.getTask(task.uuid);
        if (refreshed) return refreshed;
      }

      return task;
    }

    throw new Error('Task was created but could not be retrieved');
  }

  /**
   * Update an existing task by UUID.
   * Runs: task <rc-overrides> <uuid> modify <modifications>
   */
  async updateTask(uuid: string, dto: UpdateTaskDto): Promise<void> {
    const modifications: string[] = [];

    if (dto.description !== undefined) {
      modifications.push(`description:${dto.description}`);
    }
    if (dto.project !== undefined) {
      modifications.push(`project:${dto.project}`);
    }
    if (dto.priority !== undefined) {
      modifications.push(`priority:${dto.priority}`);
    }
    if (dto.due !== undefined) {
      modifications.push(`due:${dto.due}`);
    }
    if (dto.scheduled !== undefined) {
      modifications.push(`scheduled:${dto.scheduled}`);
    }
    if (dto.recur !== undefined) {
      modifications.push(`recur:${dto.recur}`);
    }
    if (dto.until !== undefined) {
      modifications.push(`until:${dto.until}`);
    }
    if (dto.depends !== undefined) {
      modifications.push(`depends:${dto.depends}`);
    }
    if (dto.tags !== undefined) {
      modifications.push(`tags:${dto.tags.join(',')}`);
    }

    if (modifications.length > 0) {
      const { stderr, exitCode } = this.execTask([
        uuid,
        'modify',
        ...modifications,
      ]);

      if (exitCode !== 0) {
        throw new Error(
          `Failed to update task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
        );
      }
    }

    // Annotations are managed separately via annotate/denotate commands
    if (dto.annotation !== undefined) {
      const task = await this.getTask(uuid);
      if (!task) {
        throw new Error(`Task ${uuid} not found`);
      }
      if (task.annotations?.length) {
        for (const ann of task.annotations) {
          await this.removeAnnotation(uuid, ann.description);
        }
      }
      if (dto.annotation) {
        await this.addAnnotation(uuid, dto.annotation);
      }
    }
  }

  /**
   * Mark a task as completed.
   * Runs: task rc.confirmation=off <uuid> done
   */
  async completeTask(uuid: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'done']);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to complete task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Restore a completed task back to pending status.
   * Runs: task <uuid> modify status:pending
   */
  async undoComplete(uuid: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([
      uuid,
      'modify',
      'status:pending',
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to undo complete task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Archive a task by completing it with a backdated end date.
   * Uses two separate modify calls so the end-date change applies
   * even when the task is already in completed status.
   */
  async archiveTask(uuid: string): Promise<void> {
    // Ensure the task is marked completed (no-op if already done)
    this.execTask([uuid, 'modify', 'status:completed']);

    // Backdate the end date so the task moves to the archive
    const { stderr, exitCode } = this.execTask([
      uuid,
      'modify',
      'end:yesterday',
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to archive task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Delete a task.
   * Runs: task rc.confirmation=off <uuid> delete
   */
  async deleteTask(uuid: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'delete']);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to delete task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Start tracking time on a task.
   * Runs: task <uuid> start
   */
  async startTask(uuid: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'start']);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to start task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Stop tracking time on a task.
   * Runs: task <uuid> stop
   */
  async stopTask(uuid: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'stop']);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to stop task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Add an annotation to a task.
   * Runs: task <uuid> annotate <text>
   */
  async addAnnotation(uuid: string, text: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'annotate', text]);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to annotate task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Remove an annotation from a task matching the given pattern.
   * Runs: task <uuid> denotate <pattern>
   */
  async removeAnnotation(uuid: string, pattern: string): Promise<void> {
    const { stderr, exitCode } = this.execTask([uuid, 'denotate', pattern]);

    if (exitCode !== 0) {
      throw new Error(
        `Failed to denotate task ${uuid} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
  }

  /**
   * Get all known tags.
   * Runs: task _tags
   */
  async getTags(): Promise<string[]> {
    const { stdout, exitCode } = this.execTask(['_tags']);

    if (exitCode !== 0) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);
  }

  /**
   * Get all known projects.
   * Runs: task _projects
   */
  async getProjects(): Promise<string[]> {
    const { stdout, exitCode } = this.execTask(['_projects']);

    if (exitCode !== 0) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);
  }

  /**
   * Check whether the `task` binary is available on the system.
   */
  async isInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawnSync(['task', '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
}
