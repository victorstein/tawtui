# Mempalace Setup Flow Design

## Problem

After Slack tokens are saved and mempalace CLI is installed, Oracle is not yet usable. Three additional steps are required before the Oracle session can function:

1. Initialize a mempalace palace in a tawtui-specific directory
2. Mine any existing Slack data from the staging directory
3. Install the mempalace Claude Code plugin (project-scoped) so the Oracle session has access to memory tools

These steps currently don't exist in the codebase. Additionally, `mempalace.service.ts` uses `python3 -m mempalace` which doesn't work with pipx installations (pipx installs standalone CLI binaries).

## Solution

### Directory Layout

All new directories live under `~/.local/share/tawtui/`:

```
~/.local/share/tawtui/
├── slack-inbox/           # existing — raw Slack messages (JSON staging)
├── mempalace/             # NEW — palace database
│   ├── palace.db          # SQLite metadata
│   ├── chroma/            # Vector embeddings
│   └── wings/             # Organized memory structure
└── oracle-workspace/      # NEW — Claude Code project directory
    └── .claude/           # Project-scoped plugin config
```

- **`slack-inbox/`**: Temporary landing zone for raw Slack messages fetched by `SlackIngestionService`. Files are written here, then consumed by `mempalace mine`.
- **`mempalace/`**: The palace itself — processed, searchable memory database. Created by `mempalace init`.
- **`oracle-workspace/`**: Dedicated working directory for Oracle Claude Code sessions. The mempalace plugin is installed here at project scope so it doesn't affect the user's regular Claude Code usage.

### Readiness Detection

Currently `oracleReady = hasTokens && mempalaceInstalled`. This changes to:

```
oracleReady = hasTokens && mempalaceInstalled && oracleInitialized
```

`oracleInitialized` is detected by checking for the existence of `~/.local/share/tawtui/mempalace/palace.db` — a filesystem check with no config flag that can drift out of sync.

### MempalaceService Changes

1. **Fix CLI invocation**: Replace all `python3 -m mempalace` calls with `mempalace` (standalone CLI from pipx).

2. **New methods**:
   - `init(palacePath: string): Promise<void>` — runs `mempalace init <palacePath>`
   - `mineIfNeeded(stagingDir: string, wing: string): Promise<{ mined: boolean }>` — checks for `.json` files in staging dir, runs `mempalace mine` if any exist
   - `installPlugin(workspaceDir: string): Promise<void>` — runs `claude plugin install --scope project mempalace` with cwd set to workspace dir, creates dir if needed
   - `isInitialized(palacePath: string): boolean` — synchronous check for `palace.db`

3. All methods throw on non-zero exit codes with stderr content.

### DependencyService Changes

- `checkAll()` adds `oracleInitialized: boolean` to return type (calls `mempalaceService.isInitialized()`)
- `oracleReady` updated to require all three conditions

### DependencyTypes Changes

- Add `oracleInitialized: boolean` to `DependencyStatus`

### Setup Screen Changes (Step 3)

The setup screen gets a new Step 3: "Initialize Oracle". It auto-triggers when steps 1 (tokens) and 2 (mempalace installed) are both complete.

**Progress display** shows substep status inline:

```
  Step 3: Initialize Oracle  ✗
    ✓ Palace initialized
    ⟳ Mining existing data...
```

Substeps in order:
1. "Initializing palace..." → "Palace initialized"
2. "Mining existing data..." → "Mined N files" or "No existing data to mine"
3. "Installing Claude Code plugin..." → "Plugin installed"

On completion, Step 3 shows `✓`, `oracleReady` becomes true, and the view transitions to the Oracle session screen.

**Error handling**: If any substep fails, the error is shown inline and the flow stops. User presses `[r]` to retry. Since `isInitialized()` checks `palace.db`, retrying after a partial init skips already-completed substeps (palace won't be re-initialized if it already exists).

### Bridge & TuiService Changes

Expose the initialization flow through the bridge:
- New `initializeOracle()` method on the bridge that calls MempalaceService methods in sequence
- Returns progress updates (or a final result with substep outcomes)

### OracleView Changes

- Wire `onInitializeOracle` callback to bridge's `initializeOracle()`
- Pass callback as prop to `OracleSetupScreen`

### TerminalService Changes

- `createOracleSession()` changes cwd from `HOME` to `~/.local/share/tawtui/oracle-workspace/` so the project-scoped mempalace plugin is active in the Oracle Claude Code session.

## Files Changed

| File | Change |
|------|--------|
| `src/modules/slack/mempalace.service.ts` | Fix CLI, add init/mine/plugin/isInitialized methods |
| `src/modules/dependency.service.ts` | Add oracleInitialized check, update oracleReady |
| `src/modules/dependency.types.ts` | Add oracleInitialized to DependencyStatus |
| `src/modules/tui/components/oracle-setup-screen.tsx` | Add Step 3 with auto-trigger and progress |
| `src/modules/tui/views/oracle-view.tsx` | Wire onInitializeOracle callback |
| `src/modules/tui/bridge.ts` | Expose initializeOracle method |
| `src/modules/tui.service.ts` | Wire initializeOracle through bridge |
| `src/modules/terminal.service.ts` | Change Oracle session cwd |
| `test/mempalace.service.spec.ts` | Tests for new methods |
| `test/dependency.service.spec.ts` | Tests for oracleInitialized |

## Out of Scope

- Changes to the Slack ingestion pipeline (already works)
- Changes to the token extraction flow (already works)
- Auto-save hook configuration (handled by the mempalace plugin itself)
- Palace path configurability (hardcoded to `~/.local/share/tawtui/mempalace/` for now)
