import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { MempalaceService } from './mempalace.service';
import { SlackIngestionService } from './slack-ingestion.service';
import { ConfigModule } from '../config.module';

@Module({
  imports: [ConfigModule],
  providers: [SlackService, MempalaceService, SlackIngestionService],
  exports: [SlackService, MempalaceService, SlackIngestionService],
})
export class SlackModule {}
