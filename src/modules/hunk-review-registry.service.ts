import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { HunkReviewRecord } from './hunk-review.types';

@Injectable()
export class HunkReviewRegistry implements OnModuleInit {
  private readonly logger = new Logger(HunkReviewRegistry.name);
  private readonly storeDir = join(homedir(), '.config', 'tawtui');
  private storePath = join(this.storeDir, 'hunk-reviews.json');
  private reviews = new Map<string, HunkReviewRecord>();

  onModuleInit(): void {
    this.rediscover();
  }

  add(record: HunkReviewRecord): void {
    this.reviews.set(record.prKey, record);
    this.persist();
  }

  get(prKey: string): HunkReviewRecord | undefined {
    return this.reviews.get(prKey);
  }

  list(): HunkReviewRecord[] {
    return [...this.reviews.values()];
  }

  update(prKey: string, patch: Partial<HunkReviewRecord>): void {
    const existing = this.reviews.get(prKey);
    if (!existing) return;
    this.reviews.set(prKey, { ...existing, ...patch });
    this.persist();
  }

  remove(prKey: string): void {
    this.reviews.delete(prKey);
    this.persist();
  }

  rediscover(): void {
    try {
      if (!existsSync(this.storePath)) return;
      const data = JSON.parse(
        readFileSync(this.storePath, 'utf-8'),
      ) as HunkReviewRecord[];
      this.reviews = new Map(data.map((r) => [r.prKey, r]));
      this.logger.log(`Rediscovered ${this.reviews.size} hunk review(s)`);
    } catch {
      this.logger.warn('Failed to load hunk-reviews.json');
    }
  }

  private persist(): void {
    try {
      if (!existsSync(this.storeDir))
        mkdirSync(this.storeDir, { recursive: true });
      const tmp = `${this.storePath}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify([...this.reviews.values()], null, 2),
        'utf-8',
      );
      renameSync(tmp, this.storePath);
    } catch {
      this.logger.warn('Failed to persist hunk-reviews.json');
    }
  }
}
