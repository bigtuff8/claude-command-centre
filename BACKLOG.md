# Command Centre — Product Backlog

**Last Updated:** 2026-04-16
**Referenced by:** feature-list.json, progress.txt

---

## Status Key

| Status | Meaning |
|--------|---------|
| **complete** | Done, working, in production |
| **partial** | Works but with known caveats — see notes |
| **not_started** | Nothing built yet |

---

## Complete (31 features)

All live and working. Server runs on 0.0.0.0:4111, auto-started by launcher or watchdog on boot.

| ID | Feature | Completed | Notes |
|----|---------|-----------|-------|
| F001 | Session dashboard with real-time status | 2026-04-12 | WebSocket via Socket.io |
| F002 | Desktop toast notifications | 2026-04-12 | PowerShell native toasts (replaced node-notifier 2026-04-16) |
| F003 | Approve/deny permissions from dashboard | 2026-04-12 | 30s timeout falls through to CLI |
| F004 | Session naming and labelling | 2026-04-12 | Includes rename (F032) and start time (F033) |
| F006 | Event receiver server (Express + Socket.io) | 2026-04-12 | 0.0.0.0:4111, auto-started by launcher |
| F007 | Activity feed | 2026-04-12 | Cross-session chronological event log, plain English auto-approve messages |
| F009 | HTTP hook bidirectional validation | 2026-04-11 | PreToolUse can return allow/deny/ask |
| F010 | Hook setup + cloud template integration | 2026-04-12 | Hooks in launcher cloud template, survive settings sync |
| F011 | Portable config (config.json) | 2026-04-12 | Auto-created with defaults on first run |
| F026 | Toast notifications with click-to-dashboard | 2026-04-16 | PowerShell toasts, click opens dashboard even from Action Centre |
| F027 | Dismiss completed sessions | 2026-04-12 | |
| F028 | Transcript panel (JSONL parsing + live poll) | 2026-04-12 | Includes markdown rendering |
| F029 | Text input to dashboard-managed sessions | 2026-04-13 | Uses `claude -p` pattern |
| F030 | Click-to-terminal focus | 2026-04-12 | Win32 SetForegroundWindow, launcher PID registration |
| F031 | Transcript scroll-lock | 2026-04-16 | Fixed — only auto-scrolls when user is at bottom |
| F032 | Rename sessions (inline edit) | 2026-04-12 | Double-click session name |
| F033 | Session start time display | 2026-04-12 | |
| B001 | Launcher auto-starts CC server | 2026-04-13 | Health-check + detached spawn. Hooks in cloud template. |
| B002 | New Session modal (launcher + quick launch) | 2026-04-16 | Launcher path fallback: config → env → npm global → CLI |
| B003 | Server crash recovery + boot persistence | 2026-04-16 | Watchdog auto-restarts on crash. Windows Startup folder script for boot. |
| B004 | Graceful degradation when server is down | 2026-04-13 | Hooks fail silently by design |
| B005 | Session kill from dashboard | 2026-04-13 | Confirmation dialog, PID tracking |
| B008 | Server binds to all interfaces | 2026-04-16 | 0.0.0.0:4111, reachable via network/Tailscale |
| B010 | Accurate token usage | 2026-04-16 | Deduplicated transcript parsing. SDK sessions use CLI `result` event. totalTokens = input + output (excludes cache). |
| B011 | Toast notification click-to-dashboard | 2026-04-16 | Replaced node-notifier with native PowerShell toasts |
| B012 | Auto-approve permissions | 2026-04-16 | `autoApproveAll` config flag. Currently ON. |
| B014 | Transcript scroll-lock fix | 2026-04-16 | Removed `|| transcriptAutoScroll` short-circuit |
| B017 | Auto-approve toggle (global + per-session) | 2026-04-16 | Global toggle in metrics bar. Per-session lock icon on cards. Plain English feed messages. |
| C | Session history persistence | 2026-04-16 | `data/state.json` auto-saves every 30s. Sessions, feed events, usage, autoApprove survive restarts. |

---

## Partial (2 features)

Working but with known limitations.

| ID | Feature | Priority | Issue |
|----|---------|----------|-------|
| B006 | Session hold/resume | Medium | UI exists, auto-declines permissions when held. But `claude -p` is one-shot — limited practical value until Agent SDK. |
| B007 | Cost/token tracking (legacy approximation) | Low | Superseded by B010 for accuracy. Terminal sessions still use estimated cost from transcript parsing. |

---

## Active Backlog (1 item)

| ID | Feature | Priority | Detail |
|----|---------|----------|--------|
| B016 | Mobile access with push notifications | High | Depends on B008 (done). Expose CC via Tailscale with push notifications. Scope decision needed: (a) lightweight — web push only, (b) medium — integrate Happy Coder's push relay, (c) full — match Happy Coder interactivity. Large piece of work. |

---

## Deferred

| ID | Feature | Priority | Detail |
|----|---------|----------|--------|
| B013 | Review activity feed value / UX | Low | Keep / collapse by default / remove / enhance. Parked. |

---

## Not Yet Prioritised

| ID | Feature | Detail |
|----|---------|--------|
| B018 | GitHub-based distribution with auto-pull | Move Command Centre to a GitHub repo. Use GitHub Actions to tag releases. Each device pulls updates automatically (git pull on boot/schedule or GitHub Actions webhook). Eliminates OneDrive sync dependency for code — OneDrive remains for config/state only. Enables: version-controlled releases, multi-device consistency, rollback capability, CI (lint/test on push). Approach: (1) init repo + push to GitHub, (2) setup script per device clones repo + installs deps + configures startup, (3) auto-update mechanism (cron/scheduled task runs `git pull && npm run build && restart`, or GitHub Actions triggers webhook to each device). Consider: Tailscale funnel for webhook delivery, or simple polling. |
| A | Launcher passes `--name` to sessions | Session names from `--name` flag instead of folder paths. |
| B | Send text input to terminal sessions | Extend F029 to terminal sessions via Agent SDK or stdin pipe. |
| B009 | Drag-and-drop files to sessions | Code exists, never live tested. Dashboard-managed only. |
| B015 | Detect when CLI is waiting for user input | Lower priority with auto-approve on. Poll transcript for "needs input" state. |
| D | Happy Coder compatibility | Verify HTTP hooks fire through `happy` wrapper. |
| E | Setup/handover docs | Document terminal focus for new machine setup. |

---

## Complete — Portfolio Extension (21 features)

Built 2026-04-18-19. Portfolio dashboard merged as landing page.

| ID | Feature | Notes |
|----|---------|-------|
| P001 | Markdown parser (PROJECT_STATUS.md) | Lenient, handles missing sections |
| P002 | Project directory scanner | 2-level deep, finds 50 projects in 2s |
| P003 | Portfolio state cache | In-memory, 60s refresh, Socket.io broadcast |
| P004 | Portfolio API routes | 10 endpoints under /api/portfolio/* |
| P005 | Portfolio board view (bento grid) | Gate queue, stale projects, project cards, audit tiles |
| P006 | Project detail panel | Slide-in, features/commits/session log/risks |
| P007 | SteerCo gate queue | Amber-tinted hero tile, Open Review + Launch Session |
| P008 | Session launching from portfolio | Socket event to spawner |
| P009 | Activity feed tile | Last 10 activities in board view |
| P010 | Risk register view (Risks tab) | Full table with filters, expandable rows |
| P011 | Risk accept/mitigate actions | POST to API (DB write-back in next phase) |
| P012 | Data dictionary audit tile | ✓/✗ per project with freshness |
| P013 | Tab navigation (5 tabs) | Consistent filter row frame across all tabs |
| P014 | PROJECT_REGISTRY.md parser | Via scanner directory walk |
| P015 | Git activity collector | git log per repo, 5s timeout |
| P016 | Review document detection | Glob for review.html, prototype/index.html |
| P017 | Real-time portfolio updates | Socket.io portfolio:update event |
| P018 | Feature list progress | Parses { features: [...] } format |
| P019 | Portfolio configuration | projectRoots, refreshInterval, staleness thresholds |
| P020 | Health monitoring | Proportional health score in /healthz extension |
| P021 | Activity timeline + heatmap (Activity tab) | Grouped by date, contribution grid |

---

## Active Backlog

| ID | Feature | Priority | Detail |
|----|---------|----------|--------|
| P-DB | Portfolio database layer | **Critical** | SQLite as source of truth. Sync from MD files. Process enforcement via harness + CLAUDE.md. Audit exception queue. **Next project.** |
| P-TEST | Portfolio Playwright tests | High | E2E tests for all 5 tabs |
| B016 | Mobile push notifications | Medium | Scope decision pending |
| B018 | GitHub distribution + auto-pull | Medium | **Phase 1 complete:** repo on GitHub, auto-update script pulls on boot. **Phase 2:** scheduled task for periodic checks, multi-device clone/setup script. |

---

## Known Issues

1. **Pre-existing sessions invisible** — Sessions started before hooks were injected don't appear. Fundamental limitation.
2. **Session names derived from folder only** — `--name` flag may not be in hook payload.
3. **Portfolio data from file parsing** — MD files are not a reliable source of truth for activity. Database layer (P-DB) will fix.
4. **Health score 32%** — Reflects real state but coarse. Many projects missing data dictionaries is expected, not a crisis.
5. **Risk register empty** — Template file with placeholder rows. Risks will populate as SteerCo Companion is used.
6. **Portfolio tests not written** — No Playwright coverage for portfolio tabs yet.

---

## Future Ideas (Unscoped)

- Ambient audio/visual indicators for session health
- Cross-session diff viewer (files changed across all sessions)
- Dark/light theme toggle
- Session replay (view historical session activity)
- Portfolio mobile push notifications for gate arrivals
- Trend visualisations for portfolio health over time
