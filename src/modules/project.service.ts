import { Injectable } from '@nestjs/common';
import { ConfigService } from './config.service';
import { TaskwarriorService } from './taskwarrior.service';

@Injectable()
export class ProjectService {
  constructor(
    private readonly config: ConfigService,
    private readonly taskwarrior: TaskwarriorService,
  ) {}

  getAllProjects(): string[] {
    const persisted = this.config.getPersistedProjects();
    const live = this.taskwarrior.getProjects();
    return [...new Set([...persisted, ...live])].sort();
  }

  addProject(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.config.addPersistedProject(trimmed);
  }

  removeProject(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.config.removePersistedProject(trimmed);
  }
}
