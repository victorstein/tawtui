# Skill: Run Tests

## Commands

| Command | Description |
|---|---|
| `bun run test` | Run all unit tests (Jest) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:cov` | Run tests with coverage report |

## Test File Conventions

- Unit tests: `test/<service-name>.spec.ts`
- Test config: `package.json` jest section + `tsconfig.test.json`

## Test Framework

- **Jest 30** with `ts-jest` transform
- TypeScript config: `tsconfig.test.json` (extends main tsconfig)
- Test environment: `node`
- Module mapper: `bun:sqlite` → mock (for LevelDB tests)

## Running Specific Tests

```bash
# Run tests matching a pattern
bun run test -- --testPathPatterns "slack-ingestion|oracle"

# Run a single test file
bun run test -- --testPathPatterns plimit
```

Note: Use `--testPathPatterns` (not `--testPathPattern` — deprecated).

## Mocking Bun Globals

Tests run under Jest/Node, not Bun runtime. Mock `Bun` at the top of the test file:

```typescript
const mockSpawnSync = jest.fn().mockReturnValue({ exitCode: 1 });
const mockSpawn = jest.fn();

(globalThis as Record<string, unknown>).Bun = {
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
};
```

For async spawn (returns a process with `.exited` promise):

```typescript
mockSpawn.mockReturnValueOnce({
  exited: Promise.resolve(0),
  stderr: new ReadableStream(),
  stdout: new ReadableStream(),
});
```

## Mocking Fetch

```typescript
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ ok: true, data: 'test' }),
});
```

## Debugging Tips

- If tests fail with import errors, check `tsconfig.test.json` module settings
- Use `--verbose` flag for detailed test output: `bun run test -- --verbose`
