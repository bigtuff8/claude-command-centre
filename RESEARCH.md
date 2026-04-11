# Command Centre — Research Document

**Date:** 2026-04-11
**Author:** James Brown (via Claude)
**Purpose:** Comprehensive research into multi-session Claude Code management, existing tools, and the path to building a command centre

---

## Problem Statement

Running multiple Claude Code sessions simultaneously on a single Windows machine with no centralised visibility. When 3-5 sessions are active across different projects, there is no way to:

1. See at a glance which sessions need authorisation/input
2. See which sessions have completed their work
3. Get notified when any session changes state (waiting → active → complete)
4. Manage approvals from one place instead of switching between terminal tabs

The existing Launcher + Happy Coder setup solves ~70% of this (Happy Coder provides mobile push notifications and web viewing), but the remaining 30% — desktop-native unified visibility — is unsolved.

---

## Existing Architecture

### The Launcher (`Projects/claude-workspace/launcher/`)

TypeScript/Node.js CLI tool (11 source files, ~3,300 lines). Key capabilities:

| Capability | How |
|-----------|-----|
| Device detection | Hostname → `devices.json` config |
| Project discovery | Scans Personal/Work OneDrive folders |
| MCP server management | Toggle 11+ servers on/off, per-device memory |
| Settings sync | Cloud template → `~/.claude/settings.json` with placeholder resolution |
| Hook deployment | 5 Python hooks (approval-logger, session-reporter, jira-reporter, git-guardian, work-tracker) |
| Harness injection | `--append-system-prompt` with harness prompts |
| Session launch | `spawn('claude'|'happy', [...flags], { cwd, stdio: 'inherit' })` |
| Post-session review | Pending approvals + Jira updates reviewed on startup |
| Standards sync | GitHub poc-template → local .work-standards/ |

**Launch model:** Spawn Claude with `stdio: 'inherit'` (direct terminal passthrough). Launcher exits when Claude exits. No ongoing monitoring during the session.

### Happy Coder

Self-hosted relay on Home-Desktop-JB-New (port 3005, Tailscale HTTPS). Provides:
- iOS push notifications when sessions need permission
- Web client view of concurrent sessions
- Inline response from mobile/web
- Transparent wrapper (`happy` instead of `claude`) — all flags pass through

**Limitation:** Desktop-only (always-on machine). Laptop/tablet use direct `claude`.

### Hook System

| Hook | Event | Output |
|------|-------|--------|
| approval-logger.py | PreToolUse | `~/.claude/approvals/session-{id}.jsonl` |
| session-reporter.py | SessionEnd | `pending-approvals.json` (cloud) |
| jira-reporter.py | SessionEnd | `pending-jira-updates.json` (cloud) |
| git-guardian.py | PreToolUse | Blocks direct Pi SSH/edits |
| work-tracker.py | Various | Billable hours tracking |

---

## Claude Code Programmatic Capabilities

### Headless Mode (`-p` / `--print`)
- Non-interactive: `claude -p "task" --allowedTools "Read,Edit,Bash"`
- Output formats: `text`, `json`, `stream-json` (real-time NDJSON)
- `--bare` mode: skip auto-discovery for fast scripted use
- `--input-format stream-json`: bidirectional streaming

### Session Management
- `--resume <session-id>` / `--continue`: resume prior sessions
- `--name "my-session"`: name sessions for identification
- `--session-id <uuid>`: use specific session ID
- Session data stored in `~/.claude/projects/` (JSONL by UUID)
- `~/.claude/projects/{path}/sessions-index.json`: session summaries

### Permission Modes
| Mode | Behaviour |
|------|-----------|
| `default` | Prompts for each tool on first use |
| `acceptEdits` | Auto-approves file edits + common FS commands |
| `plan` | Read-only |
| `auto` | Auto-approves with background safety checks |
| `dontAsk` | Auto-denies unless pre-approved |
| `bypassPermissions` | Skips all prompts (except .git etc.) |

### HTTP Hooks (Key for Command Centre)
Claude Code can POST JSON to external URLs on 26+ lifecycle events:
```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks/permission-request",
  "headers": { "Authorization": "Bearer $TOKEN" }
}
```

**Events most relevant:**
- `PermissionRequest` — session needs authorisation
- `SessionEnd` — activity complete
- `PostToolUse` — tool executed
- `TaskCompleted` — task finished
- `SubagentStop` — sub-agent finished
- `SessionStart` — new session began

### Claude Agent SDK
- TypeScript: `@anthropic-ai/claude-agent-sdk`
- Python: `claude-agent-sdk`
- Spawn sessions via `query()` — returns async iterator of messages
- Capture `session_id`, resume, fork sessions
- Hooks/callbacks: PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd
- Custom spawn functions for VMs/containers/remote

### Agent Teams (Experimental)
- Env: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- Team lead coordinates teammates with shared task list + mailbox
- In-process mode works on Windows (Shift+Down to cycle)
- Split-pane mode needs tmux (WSL only on Windows)

---

## Existing Tools Assessment

### Verified Windows-Compatible

| Tool | Type | Install | Launcher Compatible? | Notes |
|------|------|---------|:---:|-------|
| **CCManager** | TUI session manager | `npx ccmanager` | No — replaces launcher | No tmux needed. Manages sessions itself. |
| **Nimbalyst** | Desktop app (Electron) | `.exe` from nimbalyst.com | No — replaces launcher | Free. Kanban board, transcript search, file tracking. |
| **Agent Teams** | Built-in Claude feature | Env var | Yes — runs inside session | Single-session parallelism only. |

### macOS Only (Not Viable)

| Tool | Why Not |
|------|---------|
| **claude-view** | No Windows binary ever shipped. Compiled binary, not Node.js. Confirmed 404 on download. |
| **Claude Squad** | Requires tmux |
| **claude-code-monitor** | macOS only (iTerm2/Terminal.app focus switching) |

### WSL Only (Not Viable for This Setup)

| Tool | Why Not |
|------|---------|
| **tmux-based tools** (workmux, muxtree, claude-tmux) | Launcher is Windows-native, Happy Coder relay is Windows-native. WSL breaks path resolution. |

### Verdict

**No off-the-shelf tool provides a Windows-native command centre that complements (rather than replaces) the existing launcher.** The tools that work on Windows (CCManager, Nimbalyst) are session launchers that would require abandoning all custom launcher functionality (device detection, MCP management, hook pipeline, approval system, Jira pipeline, harness system, Happy Coder integration, standards sync).

---

## Build Path: HTTP Hooks Command Centre

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  LAUNCHER                        │
│  (existing — spawns sessions as today)           │
│  + deploys HTTP hook config to settings.json     │
│  + new "dashboard" command to start receiver     │
└────────┬─────────────────────────────────────────┘
         │ spawns N sessions (claude/happy)
         ▼
┌─────────────────────────────────────────────────┐
│              CLAUDE CODE SESSIONS                │
│  Session 1 ─── HTTP hooks ──┐                   │
│  Session 2 ─── HTTP hooks ──┤                   │
│  Session 3 ─── HTTP hooks ──┤                   │
│  Session 4 ─── HTTP hooks ──┘                   │
└──────────────────────────────┤──────────────────┘
                               ▼
┌─────────────────────────────────────────────────┐
│           COMMAND CENTRE SERVER                  │
│  Express + Socket.io (localhost:PORT)            │
│  - Receives events from all sessions            │
│  - Tracks session state (active/waiting/done)   │
│  - Aggregates events into timeline              │
│  - Emits desktop notifications (node-notifier)  │
│  - Serves web dashboard                         │
└────────┬────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────┐
│              WEB DASHBOARD                       │
│  Browser at localhost:PORT                       │
│  - Session cards with status indicators         │
│  - Event feed (permission requests, completions)│
│  - Approve/Deny buttons for permissions         │
│  - Click to focus terminal tab (if possible)    │
│  - Cost/token tracking per session              │
└─────────────────────────────────────────────────┘
```

### Key Technical Questions

1. **Can HTTP hooks respond with approve/deny?** — If yes, the dashboard can route permission decisions. If no, it's notification-only and the user still switches terminal tabs to approve.
2. **Does Happy Coder pass through HTTP hook events?** — If yes, sessions via `happy` are visible. If no, only direct `claude` sessions appear.
3. **Can we detect "waiting for input" state?** — HTTP hooks fire on specific events. Is there a `PermissionRequest` or `UserInputRequired` event we can catch?
4. **Session identification** — How do we label sessions? The `--name` flag provides a display name. Does this appear in hook event payloads?

### Tech Stack

- **Server:** Express + Socket.io (Node.js — matches launcher stack)
- **Frontend:** Vanilla HTML/CSS/JS or React (lightweight, no build step preferred for prototype)
- **Notifications:** `node-notifier` for Windows toast notifications
- **Config:** Extension of existing `claude-settings.json` template
- **Deployment:** Runs locally alongside launcher. Could be a new launcher command.

### Alternative: Agent SDK Approach

If HTTP hooks can't respond with approve/deny (making it notification-only), the Agent SDK approach becomes more attractive:

- Replace `spawn('claude')` with `query({ prompt })` from the SDK
- Full programmatic control: capture output, send input, approve/deny
- But: requires rearchitecting the launcher from "spawn and exit" to "persistent orchestrator"
- And: may conflict with Happy Coder (SDK spawns Claude directly, not via `happy` wrapper)

---

## Recommendations

### Phase 1: Validate HTTP Hooks (1-2 hours)
1. Add a test HTTP hook to `claude-settings.json` for `PermissionRequest` event
2. Run a Claude session, trigger a permission prompt
3. Verify the hook fires, inspect the payload
4. Test whether the hook can respond with approve/deny
5. Test whether `happy`-wrapped sessions fire the same hooks

### Phase 2: Build Command Centre MVP (Days)
Based on Phase 1 findings:
- If hooks can respond: Full command centre with approval routing
- If hooks are notification-only: Dashboard + notifications, approval still in terminal

### Phase 3: Launcher Integration
- Add `npm run dashboard` command to launcher
- Auto-deploy HTTP hook config via settings sync
- Desktop toast notifications via `node-notifier`

---

## Sources

- Claude Code CLI Reference: https://code.claude.com/docs/en/cli-reference
- Claude Code Hooks Guide: https://code.claude.com/docs/en/hooks-guide
- Claude Code Permissions: https://code.claude.com/docs/en/permissions
- Claude Code Headless/Programmatic: https://code.claude.com/docs/en/headless
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- claude-view GitHub: https://github.com/tombelieber/claude-view (macOS only)
- CCManager GitHub: https://github.com/kbwo/ccmanager
- Nimbalyst: https://nimbalyst.com
- Claude Squad: https://github.com/smtg-ai/claude-squad
