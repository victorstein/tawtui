# Skill: Run Tests

## Commands

| Command | Description |
|---|---|
| `bun run test` | Run all unit tests (Jest) |
| `bun run test:e2e` | Run end-to-end tests |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:cov` | Run tests with coverage report |

## Test File Conventions

- Unit tests: `src/**/*.spec.ts` (co-located with source)
- E2E tests: `test/**/*.e2e-spec.ts`
- Test config: `package.json` jest section + `test/jest-e2e.json`

## Test Framework

- **Jest 30** with `ts-jest` transform
- **@nestjs/testing** for service tests (Test.createTestingModule)
- Test environment: `node`

## Debugging Tips

- If tests fail with import errors, check `tsconfig.json` module settings
- For service tests, mock `Bun.spawnSync` since it's Bun-specific
- Use `--verbose` flag for detailed test output: `bun run test -- --verbose`
