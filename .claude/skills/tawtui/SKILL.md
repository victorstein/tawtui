---
name: tawtui
description: Use when creating, querying, moving, completing, or archiving Taskwarrior tasks that show up on a tawtui board — including agent-driven task management, tasks that were created but do not appear on the board, tasks that disappeared after being completed, calendar-linked tasks, and blocked or dependent work.
---

# Managing tawtui tasks

## Overview

tawtui has no API, socket, or scriptable interface. It is a **read-only view over Taskwarrior state**, re-queried on refresh. To change what a user sees on their board, run the `task` CLI — that is the entire integration surface.

Because the board is a *view*, every column is a query. Getting a task into a column means putting the underlying task into the state that query selects for. Most mistakes come from treating the board as a store with a "column" field. There is no column field.

## Command preamble

Prefix every write with the same overrides tawtui itself uses:

```sh
task rc.confirmation=off rc.bulk=0 rc.verbose=nothing rc.color=off rc.json.array=on <args>
```

Add these two **whenever you touch `calendar_event_id`**:

```sh
rc.uda.calendar_event_id.type=string rc.uda.calendar_event_id.label="Calendar Event ID"
```

Do not assume the UDA is declared already. tawtui registers it **at runtime, per invocation** — it
is not written to the user's `~/.taskrc`, so a bare `task add … calendar_event_id:evt_123` runs with
the attribute undefined. Taskwarrior does not reject undefined attributes; it silently appends
`calendar_event_id:evt_123` to the **description** and exits 0. You get a corrupted task title, no
UDA, and no error to notice.

## The board model

| Column | Selected by | Put a task there with |
|---|---|---|
| TODO | `status:pending -ACTIVE` (pending, no `start`) | `task add …` (or `task <uuid> stop`) |
| IN PROGRESS | `status:pending +ACTIVE` (pending, **has `start`**) | `task <uuid> start` |
| DONE | `status:completed` **and `end` ≥ today midnight** | `task <uuid> done` |
| Archive (hidden behind `A`) | `status:completed` **and `end` < today** | `task <uuid> modify end:yesterday` |

`ACTIVE` is Taskwarrior's built-in virtual tag for "has a `start` timestamp", so `+ACTIVE` / `-ACTIVE`
reproduces the TODO / IN PROGRESS split exactly.

The board runs exactly two queries and merges them:

```sh
task status:pending export
task status:completed end.after:today export
```

(When the user has typed a filter with `/`, that filter text is ANDed onto both queries.)

**Archiving is not deleting.** `task <uuid> delete` and `modify status:deleted` set
`status:deleted`, which is excluded from all four views above — the task disappears from the board
*and* from the archive, recoverable only by UUID from the CLI. The archive is completed work with a
past `end` date. Never reach for `delete` when the user says "archive", "get it off my board", or
"file it away".

Consequences worth internalizing:

- **DONE only holds today's completions.** A task completed yesterday is not missing — it rolled into the archive. That is the intended lifecycle, not a bug to fix.
- **Cards are ordered by `urgency` descending**, recomputed by Taskwarrior. Creation order means nothing. To influence position, set `priority:H`, `due:`, or tags — never expect a new task at the top.
- Moving backward from DONE is `modify status:pending` followed by `start` (restoring clears `end` automatically).

## Lifecycle

| Action | Command |
|---|---|
| Create | `task add "description" project:org/repo priority:H +tag due:tomorrow` |
| Read one | `task <uuid> export` |
| Query many | `task <filter> export` |
| Start (→ IN PROGRESS) | `task <uuid> start` |
| Stop (→ TODO) | `task <uuid> stop` |
| Complete (→ DONE) | `task <uuid> done` |
| Reopen | `task <uuid> modify status:pending` |
| Archive | `task <uuid> modify status:completed` then `task <uuid> modify end:yesterday` |
| Edit fields | `task <uuid> modify priority:M due:friday project:org/repo` |
| Add tags | `task <uuid> modify +urgent +api` (`-api` removes; `tags:x,y` **replaces the whole set**) |
| Annotate | `task <uuid> annotate "PR https://github.com/org/repo/pull/1"` |
| Remove annotation | `task <uuid> denotate "<substring>"` |
| Block on another task | `task <uuid> modify depends:<other-uuid>[,<uuid>…]` |
| Delete | `task <uuid> delete` |

### Creating a task and capturing its UUID

`task add` prints `Created task 4.` — a volatile working-set ID, useless for storage. Capture the UUID immediately:

```sh
task rc.verbose=nothing add "Fix login redirect" project:org/repo priority:H +bug due:tomorrow
uuid=$(task rc.json.array=on +LATEST export | grep -o '"uuid":"[^"]*"' | head -1 | cut -d'"' -f4)
```

Always store and reference the UUID. Numeric IDs renumber as tasks complete.

### Fields that render on a card

| Field | Card effect |
|---|---|
| `description` | Card title |
| `project` | Shown inline; convention on this board is `org/repo` |
| `priority` | `H`/`M`/`L` → HIGH/MED/LOW badge |
| `tags` | Colored chips (uppercase virtual tags like `ACTIVE`, `BLOCKED` are Taskwarrior's own and are filtered out of the display) |
| `due` | Date badge, red when overdue |
| `annotations` | **Only the first annotation** is rendered in the detail pane — put the link or context there, not in annotation #4 |
| `depends` | Drives the `BLOCKED` / `UNBLOCKED` virtual tags |
| `calendar_event_id` | UDA marking a task as created from a Google Calendar event; tawtui dedupes on it so the same event is not imported twice |

## Querying

`export` emits a JSON array and is the only output an agent should parse:

```sh
task status:pending -ACTIVE export               # TODO column
task status:pending +ACTIVE export               # IN PROGRESS column
task status:completed end.after:today export     # today's DONE column
task status:completed end.before:today export    # archive
task status:pending +bug project:org/repo export
task +BLOCKED export                             # waiting on a dependency
task _projects                                   # known project keys
task _tags                                       # known tags (includes virtual tags)
```

Filter syntax: `project:x`, `+tag`, `-tag`, `priority:H`, `due.before:friday`, `description.has:login`, `status.not:deleted`, `<attr>.any:` (has any value).

## Gotchas

Each of these is verified behavior on Taskwarrior 3.4, not folklore.

| Gotcha | What actually happens |
|---|---|
| Undeclared UDA | `task add "Sync" calendar_event_id:abc` **silently appends `calendar_event_id:abc` to the description**. No error, no exit code. The UDA is not in `~/.taskrc` — always pass the `rc.uda.*` overrides. |
| "Archive" ≠ `delete` | `delete` / `status:deleted` removes the task from the board **and** the archive view. Archive = completed with `end` in the past. |
| `wait:` hides tasks | A task with a future `wait:` is excluded from `status:pending` — so it vanishes from the board — even though its exported `status` field still reads `"pending"`. Find it with `task +WAITING export` (or `status:waiting`); put it back on the board with `task <uuid> modify wait:` to clear the date. This is Taskwarrior's deliberate "hide until later" behavior, not a tawtui bug. |
| `depends` shape | The CLI takes a comma-separated string (`depends:a,b`); `export` returns a **JSON array**. Parse accordingly. |
| Exit codes | `export` returns `0` with `[]` on no match. `list` returns `1` on no match. Neither is a failure — do not treat a nonzero exit from a read as an error. |
| Descriptions with colons | Quoting handles most cases, but a description starting with a real attribute name (`"due: tomorrow"`) gets parsed as an attribute. Use `task add -- "due: tomorrow rework"` to force literal text. |
| Recurring tasks | `recur:` creates a `status:recurring` parent that never appears on the board, plus pending instances that do. Modify the instance, not the parent, unless changing the whole series. |
| `tags:x,y` on modify | Replaces every tag. To add without clobbering, use `+tag`. |
| Numeric IDs | Renumber constantly. Never persist them or pass them between steps. |

## Verifying a change landed

The TUI cannot be driven or screenshotted from a script. Verify against the same queries the board runs:

```sh
task <uuid> export                                # the task's true state
task status:pending export | grep -c '"uuid"'     # TODO + IN PROGRESS population
task status:completed end.after:today export      # what DONE will show
```

If a task is not in one of those two result sets, it will not be on the board — check `wait:`, `status:`, and the `end` date before assuming something broke.

## Not in scope

Driving the tawtui interface itself, its PR-review/agent sessions, or its Google Calendar sync. Those are user-facing flows with no scriptable entry point. This skill covers only task state, which is where agents and tawtui actually meet.
