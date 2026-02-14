# TaWTUI Memory

## Key References
- **TUI Design Reference**: `.claude/docs/tui-design-reference.md` — comprehensive guide for @tui agent covering theme tokens, gradients, buttons, borders, powerline caps, selection patterns
- **Agent Guide**: `.claude/docs/agent-guide.md` — delegation patterns, priming templates, post-task flow
- **Skills Reference**: `.claude/docs/skills-reference.md` — skill triggers and descriptions

## Conventions
- Always prime @tui agent with: "Read `.claude/docs/tui-design-reference.md` first" when delegating component work
- Tasks tab is the canonical visual reference — all components should match its patterns
- `lerpHex` and `darkenHex` are duplicated across components (board-column, task-card, dialog-confirm, tab-bar) — not yet extracted to shared utils
