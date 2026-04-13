# Command Centre

**Status:** Active
**Last Active:** 2026-04-13
**Quick Context:** Web dashboard for monitoring and managing multiple Claude Code sessions from a single view. Windows-native, portable, shareable.

## Current State

- **Research:** Complete — 11 tools assessed, none viable on Windows without replacing Launcher
- **Design:** Complete — v1 (MVP), v2 (feature extensions), v3 (priority backlog B001-B009). All approved.
- **Build (0.1.0 MVP):** 17 features complete.
- **Build (0.2.0 Priority Backlog):** 9 features (B001-B009) designed, built, and tested. 33 Playwright E2E tests, 0 failures.
- **Launcher Integration (B001):** HTTP hooks now in the cloud settings template (`claude-settings.json`). Launcher auto-starts CC server on every launch. **Hooks no longer disappear on settings sync.**
- **New Session Modal (B002):** Redesigned with "Open Launcher" (primary) and "Quick Session" (secondary) paths. Closes the launcher gap — full sessions go through launcher, quick sessions remain dashboard-managed.
- **Server Lifecycle (B003):** pm2 scripts added. `npm run pm2:start` for persistent background process.
- **Graceful Degradation (B004):** 5s timeouts on fire-and-forget hooks. Sessions work normally when CC is down.
- **Session Kill (B005):** Stop button on cards, confirmation dialog, new `stopped` status. Works for dashboard-managed and PID-tracked terminal sessions.
- **Session Hold (B006):** Hold/resume for dashboard-managed sessions. Auto-declines permissions when held.
- **Cost Tracking (B007):** Token usage extracted from transcript JSONL. Per-session and aggregate API endpoints. Metrics bar shows live totals.
- **Mobile (B008):** Responsive CSS for phone/tablet. `host` config for network binding (Tailscale).
- **Drag-and-Drop (B009):** Drop text files onto transcript panel. Content prepended to next message.
- **Testing:** 33 Playwright E2E tests, all passing. Run with `npm test`.
- **Backlog:** Updated at `BACKLOG.md` — all 9 priority items complete. 4 items remain unprioritised.

### What's Working
- Express + Socket.io server on localhost:4111
- Hook endpoints receive real Claude Code events (verified live)
- Setup script merges HTTP hooks into existing settings without breaking Python hooks
- TypeScript compiles with zero errors
- Dashboard renders, connects to server, shows session cards + activity feed in real-time
- **Permission approve/deny from dashboard** — verified working end-to-end (30s timeout, falls through to CLI)
- **Desktop toast notifications** — fire on permission requests, clickable (opens dashboard in browser)
- **Session transcript panel** — full JSONL parsing, live polling, renders user/assistant/tool messages
- **Transcript scroll-lock** — incremental DOM append preserves scroll position when reading history. Working indicator add/remove is now conditional (fixes permission-event scroll reset bug).
- **Click-to-terminal focus** — Win32 SetForegroundWindow with Alt key trick, brings CLI window to front from dashboard
- **Dismiss completed sessions** — x button on completed/errored cards
- **Rename sessions** — double-click session name on card for inline rename, syncs via Socket.io
- **Session start time** — shown on cards and sidebar
- **Markdown rendering** in assistant messages (bold, code, code blocks)
- Session labelling derived from project folder names
- Transcript path auto-derived from session_id + cwd
- **New Session button** — opens cmd window for terminal sessions, or spawns dashboard-managed session
- **F029: Text input from dashboard** — dashboard-managed sessions with streaming output, input bar, thinking state, keyboard icon. Verified working end-to-end.
- **Test cleanup endpoint** — `DELETE /api/sessions/test-cleanup` removes test sessions from server memory

### Launcher Gap (Addressed by B002)

**Resolved.** The New Session modal now has two paths:
1. **"Open Launcher"** — opens the full launcher in a terminal (project selection, MCP, harness, standards)
2. **"Quick Session"** — dashboard-managed `claude -p` for lightweight interactions

Dashboard-managed sessions are intentionally simple. Full-featured sessions go through the launcher.

### What Needs Work
- **F037 (scroll-lock on permissions):** Fixed in code but needs live verification with real permission events
- **B009 (drag-and-drop):** Built but needs manual testing with real files — Playwright can't simulate native file drops
- **B001 (launcher auto-start):** Built but needs testing on a fresh session (this session started before the code existed)

### Remaining Unprioritised Items
- Launcher passes `--name` to sessions (F014)
- Send text input to terminal sessions (F018)
- Session history persistence (F024)
- Happy Coder compatibility (F025)

## Next Steps

1. **Live-test the launcher integration** — start a fresh session via the launcher, verify CC auto-starts and hooks fire
2. **F005: Terminal launch rework** — invoke launcher in new terminal instead of raw `claude`.
3. **F013: Launcher auto-start** — health check localhost:4111 on launcher startup, spawn server if down.
4. **F034: Drag-and-drop files** — needs design.
5. **Write Playwright tests for F029** — SDK session launch, text input, streaming output, follow-up messages.
6. **GitHub repo + npm publish** — package for distribution.

## How to Resume

1. Read this file for current state
2. The server may already be running — check with `curl -s http://localhost:4111/healthz`
3. If not running: `cd "Command Centre" && npm run build && npm start` (or `npm run pm2:start` for persistent)
4. HTTP hooks are in the launcher cloud template — they survive settings sync automatically
5. Open dashboard at http://localhost:4111
6. Run tests: `npm test` (33 Playwright E2E tests, server must be running)
7. Design docs: `design-spec.md` (v1), `design-spec-v2.md` (v2), `design-spec-v3.md` (v3 backlog)
8. Technical docs: `ARCHITECTURE.md`, `BACKLOG.md`
9. Source: `src/` (TypeScript), `public/` (frontend), `tests/` (Playwright)
10. Launcher integration: `claude-workspace/launcher/src/command-centre.ts` (auto-start module)

## Key Files

| File | Purpose |
|------|---------|
| `src/services/sdk-session.ts` | **NEW** — SDK session management (spawn, parse, stream, resume) |
| `src/` | TypeScript server source (11 files) |
| `public/` | Dashboard frontend (index.html, styles.css, app.js) |
| `tests/` | Playwright E2E tests (33 tests) |
| `prototype/` | Interactive HTML prototype (design reference) |
| `ARCHITECTURE.md` | Technical architecture, hook payloads, permission holding pattern |
| `BACKLOG.md` | Feature roadmap (0.1.0 → 0.4.0+) |
| `design-spec.md` | Full design system, components, layouts, states |
| `design-spec-v2.md` | Feature extensions + SDK API reference + spawn debugging notes |
| `design-spec-v3.md` | Priority backlog designs (B001-B009) |
| `RESEARCH.md` | Tool assessment, Claude Code capabilities, build path rationale |
| `DATA_DICTIONARY.md` | All data fields documented |
| `config.json` | Runtime config (port, timeouts, notification prefs) |
| `playwright.config.ts` | Playwright test configuration |

## Session Log

| Date | Summary |
|------|---------|
| 2026-04-11 | Research phase complete. Assessed 11 tools — none viable on Windows without replacing Launcher. Identified HTTP hooks + web dashboard as build path. Project initialised via build harness. Feature list generated. |
| 2026-04-12 (am) | Design + build completed in earlier session. Server verified with 2 live sessions. Hooks were missing from settings.json — ran setup script to inject 4 HTTP hooks alongside existing Python hooks. |
| 2026-04-12 (pm) | Major feature session. Fixed permission race condition. Built: F027 (dismiss sessions), F028 (transcript panel), F030 (click-to-terminal), working indicator. Designed: F029, F005, F013 in design-spec-v2.md. |
| 2026-04-12 (eve) | Built: F026 (clickable toasts), F031 (scroll-lock), F032 (rename), F033 (start time). Fixed: spawner `wt`→`cmd`, HTTP hooks re-injected, rename DOM bug. Set up Playwright (21 tests). SDK research complete for F029. |
| 2026-04-13 (am) | **F029 text input built.** CLI stream-json approach. sdk-session.ts service, input bar UI, thinking state. Spawn hang fix: `bash -c 'echo "" \| claude ...'`. Identified launcher gap. Added F035-F037 to backlog. 21 tests passing. |
| 2026-04-13 (pm) | **Priority backlog B001-B009 — full harness run.** Backlog prioritised and cleaned up. Ran Build harness: Initialisation → Designer → Developer → Tester. Found root cause of disappearing hooks (launcher settings-sync overwrites). Built all 9 features across launcher + CC codebases. New Session modal redesigned, kill button, hold state, cost tracking from JSONL, mobile CSS, drag-and-drop files. 33 Playwright tests, 0 failures. Launcher now auto-starts CC server and preserves HTTP hooks in cloud template. |
