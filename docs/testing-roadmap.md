# Testing Roadmap

Coverage status for all service modules. Updated as new test suites are added.

## Covered (unit + adversarial integration tests)

| Module | Unit Tests | Integration Tests | Scenarios | Status |
|---|---|---|---|---|
| slack/slack.service | Yes | Yes (via slack-integration) | RC, BC, FC, FS | Done |
| slack/slack-ingestion.service | Yes | Yes (21 tests) | RC, BC, SM, FC, FS | Done |
| slack/mempalace.service | Yes | Yes (via slack-integration) | BC | Done |
| terminal.service | Yes | Yes (17 tests) | SM, SL, KM, CD, P, BC | Done |
| config.service | Yes | Yes (7 tests) | BC, CC | Done |
| taskwarrior.service | Yes | Yes (14 tests) | BC, V, FC | Done |
| github.service | Yes | Yes (10 tests) | BC, URL, ERR | Done |
| worktree.service | Yes | Yes (12 tests) | RC, BC, FC, OD | Done |
| calendar.service | Yes | Yes (11 tests) | TH, BC, ERR | Done |
| dependency.service | Yes | Yes (12 tests) | AF, PI, SD, PL | Done |

## Tier 2 — Complete

All Tier 2 modules now have adversarial integration tests.

## Tier 3 — Next Priority

| Module | LOC | Current Tests | Key Adversarial Scenarios |
|---|---|---|---|
| notification.service | 135 | Unit only | Binary path race, helper hangs (no timeout), large messages, concurrent sends |
| oracle-event.service | 75 | Unit only | postEvent retry/timeout, fire-and-forget error handling, large rejected files |
| slack/token-extractor.service | ~150 | Minimal unit | LevelDB corruption, keychain unavailable (macOS-only) |
| tui.service | ~300 | None | Service wiring, Oracle workspace setup, lifecycle |

## Not Planned (low risk or out of scope)

| Module | Reason |
|---|---|
| shared/plimit.ts | Utility, already tested |
| oracle/oracle-channel.ts | Standalone MCP script, not a regular service |
| cookie-decryptor.ts | Low-level crypto, macOS-only, stable |
| leveldb-reader.ts | Binary format reader, macOS-only, stable |

## Scenario Key

| Code | Category |
|---|---|
| RC | Race Conditions |
| BC | Boundary Corruption |
| SM | State Machine Violations |
| FC | Failure Cascades |
| FS | Full-Stack Behavioral |
| V | Validation & User-Facing Errors |
| CC | Cache Consistency |
| URL | URL Parsing |
| ERR | Error Handling |
| OD | Orphan Detection |
| SL | Session Lifecycle |
| KM | Key Mapping |
| CD | Capture & Change Detection |
| P | Persistence |
| TH | Timeout Handling |
| AF | Aggregate Failure Handling |
| PI | Package Installation |
| SD | Slack Detection |
| PL | Platform Instructions |
