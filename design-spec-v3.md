# Design Specification v3: Command Centre Priority Backlog

**Mode:** Unconstrained
**Direction:** Mission Control (existing, approved)
**Created:** 2026-04-13
**Designer Agent Session — Backlog Features**
**Extends:** design-spec.md (v1, approved), design-spec-v2.md (v2, approved)

---

## Overview

9 features (B001-B009) extending the existing Command Centre. All designs use the established Mission Control design system. No visual language changes — these are functional extensions.

**Features by type:**
- **Infrastructure only (no UI):** B001, B003, B004
- **UI changes to existing components:** B002, B005, B006, B007
- **New UI surfaces:** B008, B009

---

## B001: Launcher Auto-Starts CC Server

**Type:** Infrastructure (launcher + cloud template changes)
**No dashboard UI changes.**

### Launcher Changes

Add to `launcher/src/index.ts` main() function, after `syncSettings()` and before `displayVersionCheck()`:

```
1. HTTP GET localhost:4111/healthz (2s timeout)
2. If 200: log "Command Centre: running ✓" (green)
3. If error/timeout:
   a. Resolve CC path (config or relative)
   b. Spawn: node [cc-path]/dist/index.js (detached, stdio: ignore, unref)
   c. Wait up to 3s, polling /healthz every 500ms
   d. If responds: log "Command Centre: started ✓" (green)
   e. If timeout: log "Command Centre: failed to start" (amber) — non-blocking
```

**Console output (new line in launcher startup):**
```
Claude Code Launcher
Device: WORK-LAPTOP

Syncing settings from cloud...
  Settings: Already up to date
  Hooks: up to date

Command Centre: running ✓        ← NEW

Claude Code version: 1.0.48 (stable)
```

### Cloud Template Fix (CRITICAL)

Add HTTP hooks to `launcher/config/claude-settings.json` alongside existing Python hooks:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "python ..." },
        { "type": "command", "command": "python ..." },
        { "type": "command", "command": "python ..." },
        { "type": "http", "url": "http://localhost:4111/hooks/pre-tool-use", "timeout": 30 }
      ]
    }
  ],
  "PostToolUse": [
    {
      "hooks": [
        { "type": "http", "url": "http://localhost:4111/hooks/post-tool-use", "timeout": 5 }
      ]
    }
  ],
  "SessionStart": [
    {
      "hooks": [
        { "type": "http", "url": "http://localhost:4111/hooks/session-start", "timeout": 5 }
      ]
    }
  ],
  "SessionEnd": [
    {
      "hooks": [
        ...(existing Python hooks),
        { "type": "http", "url": "http://localhost:4111/hooks/session-end", "timeout": 5 }
      ]
    }
  ]
}
```

**Timeout values:** PreToolUse = 30s (holds for permission approval). All others = 5s (fire-and-forget, but with a ceiling so a dead server doesn't slow sessions down).

### CC Path Resolution

Add to launcher config (`launcher/config/launcher-config.json`):

```json
{
  "commandCentre": {
    "enabled": true,
    "path": "{{PROJECTS_PATH}}/Work/Claude Agents/Command Centre",
    "port": 4111
  }
}
```

The launcher resolves `{{PROJECTS_PATH}}` the same way it resolves other template variables.

---

## B002: New Session Invokes Launcher

**Type:** UI change (modal redesign)
**Extends:** design-spec-v2.md Feature 4 (already partially designed)

### Modal Layout

```
┌────────────────────────────────────────────────────┐
│  New Session                                  [✕]  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  🚀  Open Launcher                           │  │
│  │                                              │  │
│  │  Full project selection, MCP servers,        │  │
│  │  harness, and standards sync                 │  │
│  │                                              │  │
│  │  Opens in a new terminal window              │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ── or ──                                          │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  ⌨  Quick Session (dashboard-managed)        │  │
│  │                                              │  │
│  │  Fast, lightweight — no harness or MCP.      │  │
│  │  Type directly from the dashboard.           │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ▸ Quick Session Options (click to expand)         │
│  ┌──────────────────────────────────────────────┐  │
│  │  Project directory: [________________________] │  │
│  │  Session name:      [________________________] │  │
│  │  Permission mode:   [default ▾]               │  │
│  │                                               │  │
│  │                           [Start Session]     │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Visual Specification

**Modal container:**
- Background: `var(--bg-elevated)` (#1e1e21)
- Border: 1px `var(--border)`, 16px radius
- Width: 480px, centred with backdrop blur
- Padding: 24px

**"Open Launcher" button:**
- Full-width, 64px height
- Background: `var(--blue)` (#3b82f6)
- Hover: `var(--blue)` at 90% brightness
- Border-radius: 12px
- Text: "Open Launcher" in 16px, 600 weight, white
- Subtitle: 12px, `rgba(255,255,255,0.7)`
- Rocket emoji (🚀) left-aligned, 24px

**"Quick Session" button:**
- Full-width, 56px height
- Background: `var(--bg-card)` (#111113)
- Border: 1px `var(--border)`
- Hover: border → `var(--border-hover)`
- Border-radius: 12px
- Text: "Quick Session" in 14px, 500 weight, `var(--text-primary)`
- Subtitle: 12px, `var(--text-muted)`
- Keyboard emoji (⌨) left-aligned, 20px

**Divider:** "── or ──" centred, `var(--text-muted)`, 11px, with `var(--border)` lines extending to edges

**Quick Session Options:** Collapsed by default. Chevron toggle (▸/▾). When expanded, shows the existing form fields from the current modal. The "Start Session" button is `var(--blue)`, smaller (36px height).

### Behaviour

1. **Open Launcher clicked:** Modal closes. Toast: "Launcher opened — session will appear when started". Server spawns `cmd /c start cmd /k node [launcher-path]/dist/index.js` (new terminal window). User completes launcher flow. Session registers via hooks.

2. **Quick Session clicked (without expanding options):** Expand the options section automatically and focus the project directory input.

3. **Start Session clicked:** Same as current F029 flow — spawns dashboard-managed `claude -p` session.

---

## B003: Server Process Management

**Type:** Infrastructure (no dashboard UI changes)

### Approach: pm2

pm2 is the simplest option that provides:
- Auto-restart on crash
- Background process (survives terminal closure)
- Log file management
- Startup script (survives reboot)

### Implementation

**New npm scripts in package.json:**
```json
{
  "scripts": {
    "pm2:start": "pm2 start dist/index.js --name command-centre --output logs/out.log --error logs/error.log",
    "pm2:stop": "pm2 stop command-centre",
    "pm2:restart": "pm2 restart command-centre",
    "pm2:status": "pm2 status command-centre",
    "pm2:logs": "pm2 logs command-centre",
    "pm2:startup": "pm2 startup && pm2 save"
  }
}
```

**New dependency:** `pm2` (global install recommended, not per-project)

**Launcher integration (extends B001):**
Instead of `spawn('node', [path])`, the launcher uses:
```
pm2 start [cc-path]/dist/index.js --name command-centre --silent
```
If pm2 is not installed, fall back to detached node spawn (same as B001 basic approach).

**Log directory:** `Command Centre/logs/` (gitignored)

### Config Addition

```json
{
  "server": {
    "processManager": "pm2",
    "logDir": "./logs"
  }
}
```

If `processManager` is `"none"`, use basic detached spawn. If `"pm2"`, use pm2 commands.

---

## B004: Graceful Handling of Server Not Running

**Type:** Infrastructure + verification (minimal UI)

### Hook Timeout Configuration

Add explicit timeouts to all hooks in the cloud template:

| Hook | Timeout | Rationale |
|------|---------|-----------|
| PreToolUse (HTTP) | 30s | Must wait for permission approval |
| PostToolUse (HTTP) | 5s | Fire-and-forget notification |
| SessionStart (HTTP) | 5s | Fire-and-forget notification |
| SessionEnd (HTTP) | 5s | Fire-and-forget notification |

**Without explicit timeouts**, Claude Code's default hook timeout applies. If the server is down, each hook call waits for the connection to timeout before proceeding. With 5s explicit timeouts on fire-and-forget hooks, the worst case is 5s delay per tool call when the server is unreachable.

### Dashboard Reconnection (existing design, minor update)

The existing design spec (v1) already defines a red reconnection banner:
> "Red banner at top: 'Disconnected from Command Centre server. Reconnecting...' with retry countdown"

**Enhancement:** Add a reconnection attempt counter and a "Connect" button for manual retry:

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ Disconnected from server. Reconnecting (attempt 3)... │
│                                              [Retry Now] │
└──────────────────────────────────────────────────────────┘
```

- Background: `var(--rose-dim)`
- Border: 1px `var(--rose)` at 30% opacity
- Text: `var(--rose)`, 13px
- Retry button: ghost style, `var(--rose)` border + text, 11px uppercase
- Auto-retry: exponential backoff (1s, 2s, 4s, 8s, max 30s)

---

## B005: Session Kill

**Type:** UI change (new button + dialog)

### Kill Button on Session Cards

Add a stop/kill button to session cards — visible only for active or waiting sessions.

**Placement:** Top-right of the card, next to the status badge. Small icon button (24x24px).

```
┌─────────────────────────────────────────────┐
│ ● Session Name              [Active] [⏹]   │
│ /path/to/project                            │
│ ...                                         │
└─────────────────────────────────────────────┘
```

**Icon:** Square stop icon (⏹) — not an X (that's dismiss for completed sessions).

**Button styles:**
- Default: `var(--text-muted)`, no background
- Hover: `var(--rose)`, `var(--rose-dim)` background, 6px radius
- Active: `var(--rose)` at 80% brightness

### Confirmation Dialog

Clicking the stop button opens a confirmation:

```
┌────────────────────────────────────────────┐
│  Stop Session?                        [✕]  │
│                                            │
│  This will terminate "Auth Refactor".      │
│  Any in-progress work will be lost.        │
│                                            │
│  [Cancel]                    [Stop Session] │
└────────────────────────────────────────────┘
```

**Dialog styles:**
- Same modal style as New Session (backdrop blur, `var(--bg-elevated)`)
- Width: 400px
- "Stop Session" button: `var(--rose)` background, white text, 10px radius
- "Cancel" button: ghost style, `var(--text-secondary)` border

### Behaviour by Session Type

| Session Type | Kill Method | Outcome |
|-------------|-------------|---------|
| Dashboard-managed (`sdk-managed`) | `ChildProcess.kill('SIGTERM')` | Process terminated, session marked completed |
| Terminal (hook-monitored) with known PID | `process.kill(pid, 'SIGTERM')` | Process terminated, session marked completed |
| Terminal (hook-monitored) without PID | Show message: "This session is running in a terminal. Switch to the terminal to stop it." + focus-terminal button | No kill attempt |

**Post-kill:** Session status → `errored` (not `completed` — distinguishes clean exit from forced kill). Card shows rose status badge "Stopped".

### New Status: `stopped`

Add `stopped` to `SessionStatus` type. Visual treatment:

| Status | Dot | Badge | Behaviour |
|--------|-----|-------|-----------|
| stopped | Rose, static (no glow) | "Stopped" on rose-dim background | Same as errored but distinct label. Dismissible. |

---

## B006: Session Pause/Resume

**Type:** UI change (new buttons + state)

### Feasibility Assessment

**Dashboard-managed sessions:** `claude -p` is invoked per-message. Between messages, the session is already "paused" (no process running). There's nothing to pause — the user simply doesn't send the next message. A pause button would just disable the input bar and change the visual state.

**Terminal sessions:** No mechanism to pause a running Claude Code process. The session is autonomous once started.

### Design Decision: Lightweight "Hold" State

Rather than true process-level pause, implement a **UI-level hold** for dashboard-managed sessions:

1. **Hold button** replaces the input bar with a "Session on hold" indicator
2. Incoming permission requests during hold are auto-declined with reason "Session paused via dashboard"
3. **Resume** restores the input bar
4. Terminal sessions show the hold button greyed out with tooltip "Terminal sessions cannot be paused from the dashboard"

### Hold Button

**Placement:** In the transcript panel header, next to the session name.

```
┌─────────────────────────────────────────────────────┐
│ ← All Sessions   ● Auth Refactor   [Active]  [⏸]   │
└─────────────────────────────────────────────────────┘
```

**Icon:** Pause icon (⏸) for active sessions. Play icon (▶) for held sessions.

**Button styles:**
- Default: `var(--text-muted)`, no background
- Hover (pause): `var(--amber)`, `var(--amber-dim)` background
- Hover (resume): `var(--green)`, `var(--green-dim)` background

### On-Hold State

**Transcript panel:** Input bar replaced with:
```
┌──────────────────────────────────────────────────────┐
│  ⏸  Session on hold                     [▶ Resume]  │
└──────────────────────────────────────────────────────┘
```

- Background: `var(--amber-dim)`
- Border: 1px `var(--amber)` at 30%
- Text: `var(--amber)`, 13px
- Resume button: `var(--green)` background, white text

**Session card:** Status badge → "On Hold" (amber background, same as waiting)

**New status:** `held` added to `SessionStatus`.

| Status | Dot | Badge |
|--------|-----|-------|
| held | Amber, static (no pulse) | "On Hold" on amber-dim background |

---

## B007: Cost/Token Tracking

**Type:** UI change (cards + metrics bar)

### Data Source Research Required

Before implementation, the Developer must determine where token/cost data lives:

1. **Transcript JSONL** — check if `assistant_turn` messages include a `usage` field with `input_tokens` / `output_tokens`
2. **Session metadata** — check `~/.claude/projects/*/sessions/` for metadata files alongside JSONL
3. **Hook payloads** — check if PostToolUse or SessionEnd payloads include usage data

The design below assumes token data is available from one of these sources. If not, feature is descoped to "no data available" state.

### Session Card — Token/Cost Display

Add a new stat to the card footer, alongside existing stats (files, tools):

```
┌─────────────────────────────────────────────┐
│ ● Auth Refactor                   [Active]  │
│ /path/to/project                            │
│ Last: Edit — src/auth.ts                    │
│                                             │
│ 📁 3 files  🔧 12 tools  🪙 45.2k tokens   │
│                              ~$0.34         │
└─────────────────────────────────────────────┘
```

**Token stat:** Coin emoji (🪙), token count formatted with k/M suffix (e.g., "45.2k"), `var(--text-secondary)`
**Cost:** Below token count, right-aligned, `var(--text-muted)`, 11px, prefixed with ~

### Metrics Bar — Aggregate Totals

Update the existing metrics bar to include token and cost totals:

```
┌──────────────────────────────────────────────────────────┐
│ ⬡ CC    Sessions: 3    Attention: 1    Tokens: 142k    │
│                                        Cost: ~$1.07     │
└──────────────────────────────────────────────────────────┘
```

**New metrics:**
- "Tokens" — sum of all active session tokens, `var(--blue)` value
- "Cost" — sum of all session costs, `var(--text-muted)`, smaller font

### Cost Calculation

Use current Claude pricing (must be configurable in config.json):

```json
{
  "pricing": {
    "inputTokenPer1k": 0.003,
    "outputTokenPer1k": 0.015,
    "cacheReadPer1k": 0.0003,
    "currency": "USD"
  }
}
```

### No-Data State

If token data cannot be sourced:
- Card footer: "🪙 —" (em dash, muted)
- Metrics bar: "Tokens: —"
- Tooltip on hover: "Token data not available for this session"

---

## B008: Mobile-Accessible Dashboard

**Type:** UI change (responsive CSS + config)

### Server Binding

Add config option to bind beyond localhost:

```json
{
  "server": {
    "host": "localhost",
    "port": 4111
  }
}
```

- `"localhost"` (default): binds to 127.0.0.1 only
- `"0.0.0.0"`: binds to all interfaces (accessible via Tailscale, LAN)
- `"tailscale"`: binds to Tailscale interface IP only (safest remote option)

**Security note:** When binding beyond localhost, add a banner to the dashboard:
```
⚠ Dashboard is accessible on the network. Permission approvals can be made from any connected device.
```

### Responsive Breakpoints

Extend the existing breakpoint system from design-spec.md:

| Breakpoint | Layout |
|-----------|--------|
| > 1200px | Full layout (existing): sidebar + 3-col grid + activity feed |
| 900-1200px | Sidebar collapses to icons (40px). 2-col grid. |
| 600-900px | Sidebar hidden (hamburger). Single-col cards. Activity feed full-width below. |
| < 600px | **Mobile.** No sidebar. Single-col cards, full-width. Bottom tab bar for navigation. Transcript panel full-screen overlay. |

### Mobile Layout (< 600px)

```
┌────────────────────────────┐
│ ⬡ CC         [≡]     [+]  │  ← Compact header (hamburger + new session)
├────────────────────────────┤
│                            │
│ ┌────────────────────────┐ │
│ │ ● Auth Refactor        │ │  ← Full-width cards, stacked
│ │   Active · 23m         │ │
│ │   🔧 12 tools          │ │
│ └────────────────────────┘ │
│                            │
│ ┌────────────────────────┐ │
│ │ ⚠ API Integration      │ │  ← Amber border for attention
│ │   Permission needed    │ │
│ │   [Approve] [Deny]     │ │  ← Inline buttons on mobile
│ └────────────────────────┘ │
│                            │
│ ┌────────────────────────┐ │
│ │ ● Family Hub           │ │
│ │   Active · 1h 12m      │ │
│ └────────────────────────┘ │
│                            │
├────────────────────────────┤
│ Sessions  Activity  ⚙     │  ← Bottom tab bar
└────────────────────────────┘
```

### Mobile-Specific Changes

**Cards:**
- Simplified: name + status + elapsed time + key stat
- Permission buttons inline on the card (not in a separate permission bar)
- Tap card → full-screen transcript overlay (slides up from bottom)
- Min touch target: 44px for all interactive elements

**Transcript panel:**
- Full-screen overlay with back button (← swipe or tap)
- Input bar fixed at bottom (same as desktop)
- No "Open in Terminal" link (can't focus a terminal from mobile)

**Bottom tab bar:**
- Height: 56px
- Background: `var(--bg-card)`
- Border-top: 1px `var(--border)`
- 3 tabs: Sessions (grid icon), Activity (list icon), Settings (gear icon)
- Active tab: `var(--blue)` icon + label
- Inactive: `var(--text-muted)` icon, no label

**Permission bar:**
- On mobile, permissions appear as an urgent card at the top of the list (pinned, amber border, pulsing)
- Approve/Deny buttons are full-width, 48px height, side by side

**Activity feed:**
- Own tab (not a collapsible panel)
- Same content, simplified timestamps (relative: "2m ago")

---

## B009: Drag-and-Drop Files

**Type:** UI change (new interaction + drop zone)

### Interaction Model

**Dashboard-managed sessions only.** Terminal sessions cannot receive file content from the dashboard.

**Method:** Files dragged onto the transcript panel are read client-side (FileReader API), and their content is prepended to the next message as a code block:

```
Here is the content of `auth.service.ts`:

```typescript
[file content]
```​

[user's message]
```

This avoids needing a server-side file upload mechanism — the file content becomes part of the prompt text.

### Drop Zone

When a file is dragged over the transcript panel, show a drop zone overlay:

```
┌──────────────────────────────────────────────┐
│                                              │
│                                              │
│           ┌──────────────────┐               │
│           │   📎 Drop file   │               │
│           │   to add to      │               │
│           │   conversation   │               │
│           └──────────────────┘               │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

**Overlay styles:**
- Full transcript panel area
- Background: `var(--blue-dim)` at 80% opacity
- Border: 2px dashed `var(--blue)`, 16px inset from edges, 12px radius
- Centre box: `var(--bg-elevated)`, 12px radius, 24px padding
- Text: `var(--text-primary)`, 14px
- Icon: 📎 (32px)
- Animation: border dashes animate (rotate) while dragging over

**After drop — file indicator in input bar:**

```
┌──────────────────────────────────────────────────────┐
│ 📎 auth.service.ts (2.4 KB)                    [✕]  │
├──────────────────────────────────────────────────────┤
│ 📝 Review this file for security issues...      [⏎] │
└──────────────────────────────────────────────────────┘
```

**File indicator bar:**
- Above the input bar, same width
- Background: `var(--bg-card)`
- Border: 1px `var(--border)`, top radius 10px (input bar loses top radius)
- File icon (📎) + filename + size in `var(--text-muted)`
- Remove button (✕) right-aligned, `var(--text-muted)`, hover `var(--rose)`

### Constraints

- **Max file size:** 100KB (text files only). Larger files show error toast: "File too large — max 100KB"
- **Binary files:** Rejected with toast: "Only text files can be added to conversations"
- **Multiple files:** Stack file indicators. Max 3 files per message. Additional files show: "Max 3 files per message"
- **Terminal sessions:** Drop zone does not activate. If user tries to drag, show toast: "File drop only available for dashboard-managed sessions"

### File Type Detection

| Extension | Language Label | Accepted |
|-----------|---------------|----------|
| .ts, .tsx | TypeScript | ✅ |
| .js, .jsx | JavaScript | ✅ |
| .cs | C# | ✅ |
| .py | Python | ✅ |
| .json | JSON | ✅ |
| .md | Markdown | ✅ |
| .html, .css | HTML/CSS | ✅ |
| .sql | SQL | ✅ |
| .yaml, .yml | YAML | ✅ |
| .txt, .log | Plain text | ✅ |
| .png, .jpg, .gif | Image | ❌ (binary) |
| .exe, .dll, .zip | Binary | ❌ |
| Other | Auto-detect or plain text | ✅ if < 100KB and valid UTF-8 |

---

## Cross-Cutting: Updated Session Status Types

With B005 and B006, the session status model expands:

| Status | Dot Colour | Dot Animation | Badge Text | Badge BG |
|--------|-----------|---------------|------------|----------|
| active | Green | Pulse (2s) | "Active" | green-dim |
| waiting | Amber | Pulse (1s) | "Permission" | amber-dim |
| held | Amber | None (static) | "On Hold" | amber-dim |
| completed | Grey | None | "Completed" | transparent, border only |
| errored | Rose | None (static glow) | "Error" | rose-dim |
| stopped | Rose | None | "Stopped" | rose-dim |

**TypeScript update:** `SessionStatus = 'active' | 'waiting' | 'held' | 'completed' | 'errored' | 'stopped'`

---

## Implementation Order

| Order | Feature | Effort | Codebase |
|-------|---------|--------|----------|
| 1 | B001: Launcher auto-start + cloud template fix | Medium | Launcher + CC |
| 2 | B002: New Session modal redesign | Low | CC (frontend only) |
| 3 | B003: pm2 process management | Low | CC (scripts + config) |
| 4 | B004: Graceful degradation verification | Low | CC + cloud template (timeouts) |
| 5 | B005: Session kill | Medium | CC (server + frontend) |
| 6 | B006: Session hold | Low-Medium | CC (server + frontend) |
| 7 | B007: Cost/token tracking | Medium | CC (research + server + frontend) |
| 8 | B008: Mobile responsive | Medium | CC (CSS + config) |
| 9 | B009: Drag-and-drop files | Medium | CC (frontend) |
