# Command Centre — Product Backlog

**Last Updated:** 2026-04-15
**Referenced by:** PROJECT_STATUS.md, feature-list.json

---

## Priority Backlog (Design Scope)

Items 1-9 are the current design/build scope. Items 2+3 were merged (F005/F015 are the same work).

| # | Feature | Batch | Details |
|---|---------|-------|---------|
| 1 | Launcher auto-starts CC server | A: Launcher | On launcher startup, hit `localhost:4111/healthz`. If down, spawn as background process. If up, skip. No more manual server start. |
| 2 | New Session invokes launcher | A: Launcher | Merge of F005+F015. Redesign "New Session" to invoke the launcher instead of raw `claude`. Sessions get harness selection, MCP servers, CLAUDE.md context. Closes the launcher gap. |
| 3 | Server process management | B: Server lifecycle | Keep CC server running persistently — auto-restart on crash, survive terminal closure. Windows service, pm2, or startup script. |
| 4 | Graceful handling of server not running | B: Server lifecycle | Confirm Claude Code sessions work normally when CC is down. Hooks already fail silently — verify and tune timeouts. |
| 5 | Session kill from dashboard | C: Session control | Kill button with confirmation dialog. Handle both dashboard-managed (child process) and terminal (PID lookup) sessions. |
| 6 | Session pause/resume | C: Session control | Pause a running session to stop token consumption, resume later. May require Agent SDK — feasibility TBC during design. |
| 7 | Cost/token tracking | Standalone | Per-session token count and USD cost on cards, aggregate summary bar. Needs research into hook payload or `~/.claude/` session file contents. |
| 8 | Mobile-accessible dashboard | Standalone | Responsive CSS for phone/tablet. Expose beyond localhost via Tailscale. |
| 9 | Drag-and-drop files to sessions | Standalone | Drag files onto a session card to inject into context. Open question: attachment, copy to working dir, or path reference? Dashboard-managed only initially. |

**Build order:** Batch A (1, 2) -> Batch B (3, 4) -> Batch C (5, 6) -> 7, 8, 9 in any order

**Testing note:** Scroll-lock regression (F037) — code fix is in place, verify opportunistically during any live permission testing. Not a build task.

**Release task:** Transferability/distribution (F036) — comes after features stabilise. Sub-tasks: **a)** GitHub repo (F022) **b)** npm package bin entry (F012) **c)** npm publish for `npx` (F021). Not in design scope.

---

## Not Yet Prioritised

| # | Feature | Previous ID | Details |
|---|---------|-------------|---------|
| A | Launcher passes `--name` to sessions | F014 | Pass a `--name` flag when spawning sessions so the dashboard shows meaningful names instead of folder paths. |
| B | Send text input to terminal sessions | F018 | F029 solved input for dashboard-managed sessions. This extends it to hook-monitored terminal sessions via Agent SDK or stdin pipe. |
| C | Session history persistence | F024 | Persist sessions, transcripts, and events to disk (JSON/SQLite) so data survives server restarts. |
| D | Happy Coder compatibility | F025 | Verify HTTP hooks fire correctly through the `happy` wrapper. Ensure events, permissions, and text input all work. |
| E | Handover / setup docs for terminal focus | — | Document the auto-window-focus feature for new machine setup. Covers: launcher must be rebuilt (`npm run build` in launcher dir), `devices.json` must have the new machine entry, CC must be pulled from GitHub and built. The feature works automatically once the launcher is updated — no per-machine config needed beyond what the launcher already requires. Include in INSTALL.md or a dedicated HANDOVER.md. |

---

## Known Issues (Current Build)

1. **Server process lifecycle** — pm2 scripts exist but user must run `npm run pm2:start` once. No auto-recovery if pm2 isn't used. (Addressed by item 3)
2. **Pre-existing sessions invisible** — Sessions started before hooks were injected don't appear. Fundamental limitation of hook injection timing.
3. **Session names derived from folder only** — `--name` flag from Claude Code may not be in hook payload. (Related to unprioritised item A)
4. **Terminal focus requires updated launcher** — Sessions launched before the launcher PID registration update (2026-04-15) won't have terminal PIDs. Only affects existing sessions; new launches work automatically.

---

## Future Ideas (Unscoped)

- Ambient audio/visual indicators for session health
- Session grouping by project/workspace
- Cross-session diff viewer (files changed across all sessions)
- Integration with launcher's approval-reviewer (consolidate approval pipelines)
- Dark/light theme toggle
- Session replay (view historical session activity)

---

## Completed (17 features)

| ID | Feature | Completed |
|----|---------|-----------|
| F001 | Session dashboard with real-time status | 2026-04-12 |
| F002 | Desktop toast notifications | 2026-04-12 |
| F003 | Approve/deny permissions from dashboard | 2026-04-12 |
| F004 | Session naming and labelling | 2026-04-12 |
| F006 | Event receiver server | 2026-04-12 |
| F007 | Activity feed | 2026-04-12 |
| F009 | Hook validation | 2026-04-12 |
| F010 | Settings integration (setup script) | 2026-04-12 |
| F011 | Portable config | 2026-04-12 |
| F026 | Clickable toast notifications open dashboard | 2026-04-12 |
| F027 | Dismiss/remove completed sessions | 2026-04-12 |
| F028 | Session transcript panel | 2026-04-12 |
| F029 | Text input to sessions (CLI stream-json) | 2026-04-13 |
| F030 | Click-to-terminal focus | 2026-04-12 |
| F031 | Transcript scroll-lock (incremental append) | 2026-04-12 |
| F032 | Rename/label sessions from dashboard | 2026-04-12 |
| F033 | Show session start time on cards | 2026-04-12 |
| B001-B009 | Priority backlog (launcher integration, new session modal, pm2, graceful degradation, kill, hold, cost tracking, mobile, drag-and-drop) | 2026-04-13 |
| F038 | Terminal focus via launcher PID registration | 2026-04-15 |
| F039 | Per-session token counts in sidebar | 2026-04-15 |
| F040 | Spawner fix for paths with spaces (.bat approach) | 2026-04-15 |
