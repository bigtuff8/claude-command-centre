# Command Centre — Product Backlog

**Last Updated:** 2026-04-12
**Referenced by:** PROJECT_STATUS.md, feature-list.json

---

## Release 0.1.0 — MVP (Current Build)

Features from `feature-list.json`. Status tracked there.

| ID | Feature | Priority | Status | Notes |
|----|---------|----------|--------|-------|
| F001 | Session dashboard with real-time status | Critical | Built, needs live verification | Core value prop |
| F002 | Desktop toast notifications | Critical | Built, needs live verification | node-notifier |
| F003 | Approve/deny permissions from dashboard | Critical | Built, needs live verification | HTTP hook bidirectional |
| F004 | Session naming and labelling | High | Built, needs live verification | Derived from cwd |
| F005 | Launch new sessions from dashboard | Medium | Built, needs redesign | Must go through launcher, not raw `claude` |
| F006 | Event receiver server | Critical | Built, verified | Express + Socket.io |
| F007 | Activity feed | Medium | Built, needs live verification | Bottom panel |
| F008 | Cost/token tracking | Low | Not built | Token data may not be in hook payloads |
| F009 | Hook validation | Critical | Complete | Bidirectional confirmed |
| F010 | Settings integration (setup script) | Critical | Built, verified | Injects hooks into settings.json |
| F011 | Portable config | High | Built, verified | Auto-creates config.json |
| F012 | npm package with bin entry | Medium | Partial | package.json has bin, not published |

### Known Issues (Current Build)

1. **Server process lifecycle** — No mechanism to keep server running persistently. User must manually start in a terminal. Needs launcher integration.
2. **Pre-existing sessions invisible** — Sessions started before hooks were injected don't appear. Fundamental limitation of hook injection timing.
3. **Session names derived from folder only** — `--name` flag from Claude Code may not be in hook payload. Need to verify.
4. **No text input to sessions** — Can only approve/deny, cannot send arbitrary text. Major gap for true command centre use.
5. **Dashboard frontend untested end-to-end** — Server verified, frontend wired but needs live verification of rendering, Socket.io events, interactions.

---

## Release 0.2.0 — Launcher Integration

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| F013 | Launcher auto-starts Command Centre server | Critical | Health check `localhost:4111/healthz` on launcher startup. If down, spawn server in background. If up, skip. |
| F014 | Launcher passes `--name` to Claude sessions | High | So dashboard shows meaningful names, not just folder names |
| F015 | Dashboard "New Session" invokes launcher | High | Not raw `claude`. Opens PowerShell → runs launcher. Launcher handles project selection, MCP config, harness, etc. |
| F016 | Server process management | High | Auto-restart on crash? Windows service? Startup script? Needs design. |
| F017 | Graceful handling of server not running | Medium | Claude Code sessions should work normally if server is down. Hooks fail silently (already the case). |

---

## Release 0.3.0 — Text Input & Session Control

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| F018 | Send text input to sessions from dashboard | Critical | Requires architectural change — Agent SDK or stdin pipe. Design needed. |
| F019 | Session pause/resume from dashboard | Medium | May require Agent SDK |
| F020 | Session kill from dashboard | Low | Process termination — safety implications |

---

## Release 0.4.0 — Polish & Distribution

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| F021 | npm publish for `npx` usage | Medium | Package name availability check needed |
| F022 | GitHub repo (public/shareable) | High | Under bigtuff8 org or personal? |
| F023 | Cost/token tracking (F008 deferred) | Low | Depends on hook payload content |
| F024 | Session history persistence | Low | Currently in-memory only, lost on restart |
| F025 | Happy Coder compatibility testing | Low | Verify hooks fire through `happy` wrapper |

---

## Future Ideas (Unscoped)

- Ambient audio/visual indicators for session health
- Session grouping by project/workspace
- Cross-session diff viewer (files changed across all sessions)
- Integration with launcher's approval-reviewer (consolidate approval pipelines)
- Mobile-responsive dashboard for tablet use
- Dark/light theme toggle
- Session replay (view historical session activity)
