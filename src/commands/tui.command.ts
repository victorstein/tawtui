import { Command, CommandRunner } from 'nest-commander';
import { TuiService } from '../modules/tui.service';

@Command({
  name: 'tui',
  description: 'Launch the TaWTUI terminal interface',
  options: { isDefault: true },
})
export class TuiCommand extends CommandRunner {
  constructor(private readonly tuiService: TuiService) {
    super();
  }

  async run(): Promise<void> {
    await this.tuiService.launch();
  }
}
