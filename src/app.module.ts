import { Module } from '@nestjs/common';
import { TuiCommand } from './commands/tui.command';
import { ConfigModule } from './modules/config.module';
import { TuiModule } from './modules/tui.module';

@Module({
  imports: [ConfigModule, TuiModule],
  providers: [TuiCommand],
})
export class AppModule {}
