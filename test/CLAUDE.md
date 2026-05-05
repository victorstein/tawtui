# Test Conventions

## Structure

Every test file follows the 4-category structure per method:

```typescript
describe('ServiceName', () => {
  describe('methodName', () => {
    describe('Validation', () => { /* bad inputs, missing config */ })
    describe('Error Handling', () => { /* API failures, retries, abort */ })
    describe('Behavior', () => { /* happy path, state, callbacks */ })
    describe('Edge Cases', () => { /* concurrency, pagination, empty */ })
  })
})
```

Omit a category if a method has no tests for it (e.g., no validation for a getter).

## Naming

- `it('should <verb> <outcome>')` — always starts with "should"
- `describe` blocks use the method name or feature area

## Setup/Teardown

- `beforeEach`: `jest.clearAllMocks()`, fresh service instantiation with mocks
- `afterEach`: cleanup temp dirs, restore globals

## Mocking

- **Bun global**: set `(globalThis as Record<string, unknown>).Bun = { spawn, spawnSync }`
- **fetch**: `global.fetch = jest.fn()` with `mockResolvedValueOnce`
- **fs**: `jest.spyOn` on individual functions, restore in afterEach
- Use helpers from `test/helpers/` for mock response factories

## Helpers

- `TerminalTestHelper` — mock ExecResult, Bun.spawn results
- `TaskwarriorTestHelper` — temp taskwarrior data directory + service factory
- `WorktreeTestHelper` — temp worktree base, mock spawn router, repo/worktree factories

## Domain Folders

Tests are organized by domain: `test/calendar/`, `test/config/`, `test/github/`, `test/notification/`, `test/taskwarrior/`, `test/worktree/`, etc.

## Running Tests

```bash
bun run test                                    # All tests
bun run test -- --testPathPattern=worktree      # Domain-specific
bun run test -- --testPathPattern=notification
```
