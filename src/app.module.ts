import { Module } from '@nestjs/common';
import { TuiCommand } from './commands/tui.command';
import { ConfigModule } from './modules/config.module';
import { TuiModule } from './modules/tui.module';
import { SlackModule } from './modules/slack/slack.module';

@Module({
  imports: [ConfigModule, TuiModule, SlackModule],
  providers: [TuiCommand],
})
export class AppModule {}
