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
| notification.service | Yes | Yes (10 tests) | BC, CA, AB, TD | Done |
| oracle-event.service | Yes | Yes (7 tests) | RR, PE | Done |

## All Tiers Complete

Every service with meaningful system boundaries now has adversarial integration tests.

## Not Covered (low risk or out of scope)

| Module | LOC | Reason |
|---|---|---|
| slack/token-extractor.service | ~150 | macOS-only (LevelDB, Keychain), low ROI |
| tui.service | ~300 | Bridge/orchestrator, mocking all deps is high effort/low discovery |
| shared/plimit.ts | ~50 | Utility, already unit tested |
| oracle/oracle-channel.ts | ~100 | Standalone MCP script, not a regular service |
| cookie-decryptor.ts | ~80 | Low-level crypto, macOS-only, stable |
| leveldb-reader.ts | ~120 | Binary format reader, macOS-only, stable |

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
| CA | Caching |
| AB | Argument Building |
| TD | Terminal Detection |
| RR | Read Rejected Tasks |
| PE | Post Event |
