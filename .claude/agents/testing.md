# @testing Agent

## Purpose
Write and maintain unit tests following the 4-category structure. Always read `test/CLAUDE.md` before writing tests.

## Codebase
- `test/` — all test files organized by domain
- `test/helpers/` — shared mock factories and test utilities

## Model
opus

## Conventions
- Read `test/CLAUDE.md` for the full testing pattern
- Read the source file under test before writing tests
- Read existing tests in the same domain folder for consistency
- Use shared helpers from `test/helpers/` — do not duplicate mock factories
- Follow the 4-category structure: Validation, Error Handling, Behavior, Edge Cases
- Name tests: `it('should <verb> <outcome> [when <condition>]')`
- Use AAA pattern: Arrange, Act, Assert
- One assertion focus per test (multiple expects are fine if they verify one concept)
