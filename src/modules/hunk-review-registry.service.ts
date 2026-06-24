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
import type { ChatMessage, HunkReviewRecord } from './hunk-review.types';

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

  appendChat(prKey: string, msg: ChatMessage): void {
    const existing = this.reviews.get(prKey);
    if (!existing) return;
    this.reviews.set(prKey, { ...existing, chat: [...existing.chat, msg] });
    this.persist();
  }

  rediscover(): void {
    try {
      if (!existsSync(this.storePath)) return;
      // Loaded JSON may predate newly-required fields → treat as partial, then backfill.
      const data = JSON.parse(readFileSync(this.storePath, 'utf-8')) as Array<
        Partial<HunkReviewRecord> & { prKey: string }
      >;
      let changed = false;
      const next: HunkReviewRecord[] = data.map((raw) => {
        const r = { ...raw, chat: raw.chat ?? [] } as HunkReviewRecord;
        if (raw.chat === undefined) changed = true;
        if (r.status === 'creating' || r.status === 'reviewing') {
          changed = true;
          return { ...r, status: 'interrupted' as const };
        }
        return r;
      });
      this.reviews = new Map(next.map((r) => [r.prKey, r]));
      this.logger.log(`Rediscovered ${this.reviews.size} hunk review(s)`);
      if (changed) this.persist();
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
