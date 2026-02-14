# Skill: Create NestJS Module

Create a new NestJS module following the established triad pattern.

## Files to Create

For a module named `<name>`:

### 1. `src/modules/<name>.types.ts`

```typescript
// Define your interfaces here.

export interface <Name>Something {
  // fields
}
```

### 2. `src/modules/<name>.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import type { ExecResult } from '../shared/types';
// import types from ./<name>.types

@Injectable()
export class <Name>Service {
  private readonly logger = new Logger(<Name>Service.name);

  // If wrapping a CLI tool:
  private exec<Tool>(args: string[]): ExecResult {
    const cmd = ['<tool-binary>', ...args];
    this.logger.debug(`Executing: ${cmd.join(' ')}`);

    const proc = Bun.spawnSync(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      exitCode: proc.exitCode,
    };
  }

  // Add your service methods here
}
```

### 3. `src/modules/<name>.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { <Name>Service } from './<name>.service';

@Module({
  providers: [<Name>Service],
  exports: [<Name>Service],
})
export class <Name>Module {}
```

### 4. Register in `src/app.module.ts`

Add the module to the imports array:

```typescript
import { <Name>Module } from './modules/<name>.module';

@Module({
  imports: [
    ConfigModule,
    TuiModule,
    <Name>Module,  // Add here
  ],
  providers: [TuiCommand],
})
export class AppModule {}
```

### 5. (Optional) Bridge to TUI

If TUI components need access, add to `src/modules/tui.service.ts`:

1. Import the service
2. Inject via constructor
3. Add to `globalThis.__tawtui` object

## Reference Implementations

- **taskwarrior** — Full CRUD service wrapping `task` CLI with RC overrides
- **github** — Read service wrapping `gh` CLI with JSON output parsing
- **config** — File-based config service with atomic writes
- **terminal** — Session management wrapping `tmux`
