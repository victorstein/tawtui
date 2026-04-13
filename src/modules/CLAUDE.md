# NestJS Service Layer

## Module Triad

Every feature has three files: `{domain}.module.ts`, `{domain}.service.ts`, `{domain}.types.ts`. Look at existing modules for templates — don't invent new patterns.

## Wiring a New Module

1. Create the triad files
2. Import the module into `tui.module.ts` (NOT `app.module.ts` — only ConfigModule and TuiModule go there)
3. If TUI components need the service, add it to `TawtuiBridge` in `tui/bridge.ts` and expose in `TuiService.launch()`
4. Add a null-safe getter in `bridge.ts` for component access

`app.module.ts` → imports `ConfigModule` (global) + `TuiModule` → TuiModule transitively imports all feature modules.

## CLI Wrapper Conventions

- Use `Bun.spawn()` (async) or `Bun.spawnSync()` (sync) — never Node `child_process`
- Convert streams: `new Response(proc.stdout).text()`
- Return `ExecResult { stdout, stderr, exitCode }` — never throw on missing binary
- Exit code 0 = success, 1 = no results (graceful), >=2 = real error
- Wrap `JSON.parse` in try-catch, return empty data on failure
- Log warnings for expected failures, errors only for critical failures
- Never log AND throw the same error — choose one

## Bridge Pattern

SolidJS components can't access NestJS DI. Services are exposed via `globalThis.__tawtui`:

- `TuiService.launch()` populates the bridge object
- `bridge.ts` defines `TawtuiBridge` interface + null-safe getters
- Components call `getTaskwarriorService()`, `getGithubService()`, etc.
- Only bridge services that TUI components need directly

## Error Handling

- Detection methods (`isInstalled`): return boolean
- Data methods (`getTasks`, `getTask`): return empty array or null
- Mutation methods (`createTask`): throw on real errors only
- Always handle gracefully — the TUI must never crash from a service error

## Multi-Service Modules

When a feature has multiple cooperating services (like `slack/`), register all in one module and export all. See `SlackModule` for the pattern.

## Lifecycle

- `OnModuleInit`: load persisted state, discover resources
- `OnModuleDestroy`: persist state, clean up
