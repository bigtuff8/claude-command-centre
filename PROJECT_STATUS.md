# Command Centre

**Status:** Active
**Last Active:** 2026-04-17
**Quick Context:** Web dashboard for monitoring and managing multiple Claude Code sessions from a single view. Windows-native, portable, shareable.

## Current State

- **Version:** 0.2.0 (unreleased — no npm publish yet)
- **Server:** Live on `0.0.0.0:4111`, auto-started by launcher + watchdog on boot
- **Features:** 31 complete, 2 partial, 1 in active backlog, 6 unprioritised
- **Tests:** 33 Playwright E2E tests
- **Persistence:** Sessions and feed events survive server restarts (`data/state.json`)
- **Auto-approve:** ON — all permissions auto-approved, global + per-session toggles in dashboard

### What's Live and Working (31 features)

- Real-time session dashboard (Socket.io WebSocket)
- Permission approve/deny from dashboard (30s timeout → CLI fallback)
- Auto-approve permissions with global + per-session toggles, plain English feed messages
- Desktop toast notifications (PowerShell native, click opens dashboard from Action Centre)
- Session transcript panel (JSONL parsing, live polling, markdown rendering)
- Transcript scroll-lock (holds position when scrolled up)
- Text input to dashboard-managed sessions
- Click-to-terminal focus (Win32 SetForegroundWindow, launcher PID registration)
- Session kill with confirmation, session hold/resume
- Accurate token usage (deduplicated transcript parsing, SDK result events, input+output totals)
- New Session modal — launcher + quick launch with proper path resolution
- Launcher auto-starts CC server (health-check + detached spawn)
- HTTP hooks in launcher cloud template (survive settings sync)
- Server binds to all interfaces (0.0.0.0:4111, Tailscale/network accessible)
- Session history persistence (auto-save every 30s, survives restarts)
- Crash recovery (watchdog auto-restarts on crash)
- Boot persistence (Windows Startup folder script)
- Activity feed, dismiss sessions, rename sessions, session start time

### What's Partial

- **B006** — Hold/resume UI works but limited value (claude -p is one-shot)
- **B007** — Legacy cost estimates for terminal sessions (SDK sessions have accurate CLI cost)

### Outstanding

- **B016** — Mobile push notifications (large scope, needs scope decision)

## Next Steps

1. Decide scope for B016 (mobile push: lightweight / Happy Coder / full)
2. Test responsive CSS on real mobile device
3. Consider npm publish / GitHub distribution

## How to Resume

1. Read this file for current state
2. Server is likely already running — check: `curl -s http://localhost:4111/healthz`
3. If not running: `cd "Command Centre" && npm run build && npm start`
4. Or use watchdog: `npm run watchdog` (auto-restarts on crash)
5. Dashboard at http://localhost:4111 (or `http://<machine-ip>:4111` from other devices)
6. **Auto-approve is ON** — toggle in metrics bar or per-session lock icon on cards
7. Sessions persist across restarts (`data/state.json`)
8. Boot startup installed: `%APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/CommandCentre.bat`
9. Key docs: `BACKLOG.md`, `BACKLOG-DESIGN.md`, `ARCHITECTURE.md`, `INSTALL.md`
10. Source: `src/` (TypeScript), `public/` (frontend), `scripts/` (watchdog + installer)

## Key Files

| File | Purpose |
|------|---------|
| `src/` | TypeScript server source |
| `public/` | Dashboard frontend (index.html, styles.css, app.js) |
| `scripts/watchdog.js` | Crash recovery — respawns server on non-zero exit |
| `scripts/install-service.js` | Installs boot startup via Windows Startup folder |
| `data/state.json` | Persisted session state (auto-saved, gitignored) |
| `config.json` | Runtime config (host, port, auto-approve, timeouts, notifications) |
| `BACKLOG.md` | Current backlog with statuses |
| `BACKLOG-DESIGN.md` | Technical designs for backlog items |
| `ARCHITECTURE.md` | Technical architecture, hook payloads, permission holding pattern |
| `INSTALL.md` | Setup guide for own machines + colleague installs |
| `feature-list.json` | Machine-readable feature list with live_status per feature |

## Session Log

| Date | Summary |
|------|---------|
| 2026-04-11 | Research phase. Assessed 11 tools, identified HTTP hooks + web dashboard as build path. |
| 2026-04-12 | Design + MVP build. 17 features. Transcript panel, permissions, toasts, scroll-lock, rename. 21 tests. |
| 2026-04-13 | Text input (F029). Priority backlog B001-B009. Launcher integration. 33 tests. |
| 2026-04-15 | Terminal focus fix (PID registration). Per-session token counts. Spawner path fix. |
| 2026-04-16-17 | Major session. Backlog audit — corrected feature statuses, added B010-B017. Built: B014 (scroll-lock fix), B012 (auto-approve ON), B002 (launcher path), B008 (0.0.0.0 binding), B010 (accurate tokens — dedup + SDK result events), B011 (PowerShell toasts replacing node-notifier), B017 (global + per-session auto-approve toggles with plain English feed), C (session persistence to data/state.json), B003 (watchdog crash recovery + Windows Startup boot). Fixed totalTokens to exclude cache read/creation. Removed node-notifier dependency. Updated all docs. |
