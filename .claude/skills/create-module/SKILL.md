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

  // If wrapping a CLI tool (async, non-blocking):
  private async execTool(args: string[]): Promise<void> {
    const proc = Bun.spawn(['<tool-binary>', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`<tool> failed (exit ${exitCode}): ${stderr}`);
    }
  }

  // Add your service methods here
}
```

### Subdirectory Modules

For modules with multiple services (e.g., slack/, oracle/), use a subdirectory:

```
src/modules/<name>/
├── <name>.module.ts
├── <name>.service.ts
├── <name>.types.ts
└── <other-service>.service.ts
```

The module file imports from siblings. Register the module in `src/app.module.ts` the same way.

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

If TUI components need access, add to `src/modules/tui/bridge.ts`:

```typescript
// In src/modules/tui/bridge.ts, add a getter:
export function get<Name>Service(): <Name>Service | null {
  return (globalThis as TawtuiBridge)?.__tawtui?.<name>Service ?? null;
}
```

Also inject the service in `src/modules/tui.service.ts` and assign it on `globalThis.__tawtui`.

## Reference Implementations

- **taskwarrior** — Full CRUD service wrapping `task` CLI with RC overrides
- **github** — Read service wrapping `gh` CLI with JSON output parsing
- **config** — File-based config service with atomic writes
- **terminal** — Session management wrapping `tmux`
- **slack** — Slack API wrapper with HTTP fetch, rate limiting, and pagination
- **notification** — Wraps custom Swift helper binary
- **mempalace** — Wraps `mempalace` CLI with async Bun.spawn
- **oracle-event** — Event posting service with retry logic
