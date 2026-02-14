import { Module } from '@nestjs/common';
import { TaskwarriorModule } from './taskwarrior.module';
import { TerminalService } from './terminal.service';

@Module({
  imports: [TaskwarriorModule],
  providers: [TerminalService],
  exports: [TerminalService],
})
export class TerminalModule {}
