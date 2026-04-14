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

- `SlackTestHelper` — mock Slack API responses, conversations, state objects
- `TerminalTestHelper` — mock ExecResult, Bun.spawn results
- `StateHelper` — temp state files, rejected task directories
- `TaskwarriorTestHelper` — mock spawnSync results, task JSON factories, routed spawnSync mock
- `WorktreeTestHelper` — WorktreeService stack with temp dirs, routed async spawn mock
- `IntegrationHelper` — real Slack service stack with temp dirs

## Domain Folders

Tests are organized by domain: `test/slack/`, `test/oracle/`, `test/terminal/`, `test/taskwarrior/`, `test/github/`, `test/worktree/`, `test/config/`, etc.

## Running Tests

```bash
bun run test                                          # All tests
bun run test -- --testPathPatterns=slack               # Domain-specific
bun run test -- --testPathPatterns=oracle
bun run test -- --testPathPatterns=terminal
bun run test -- --testPathPatterns=taskwarrior
bun run test -- --testPathPatterns=github
bun run test -- --testPathPatterns=worktree
bun run test -- --testPathPatterns=config
bun run test -- --testPathPatterns=integration         # All integration tests
```

## Integration / Adversarial Tests

Integration tests live alongside unit tests in domain folders, named `*-integration.spec.ts`. They use real service construction with mocked system boundaries (Bun.spawn, fetch, fs).

Structure by scenario category (not by method):

```typescript
describe('ServiceName Integration', () => {
  describe('Boundary Corruption', () => { /* malformed input, wrong types, corrupt files */ })
  describe('Validation', () => { /* invalid user input, error messages */ })
  describe('Concurrency', () => { /* race conditions, shared promises */ })
  describe('Cache Consistency', () => { /* cache/disk divergence, stale reads */ })
  describe('Error Handling', () => { /* binary missing, auth failures */ })
  describe('Failure Cascades', () => { /* partial failures, rollback */ })
})
```

Omit categories that don't apply to the service under test.

Each test follows Given/When/Then. When a test exposes a source bug, fix the bug and commit test + fix together.
