import { Module } from '@nestjs/common';
import { ConfigModule } from './config.module';
import { TaskwarriorModule } from './taskwarrior.module';
import { TerminalService } from './terminal.service';

@Module({
  imports: [TaskwarriorModule, ConfigModule],
  providers: [TerminalService],
  exports: [TerminalService],
})
export class TerminalModule {}
