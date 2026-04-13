# Design Specification v2: Command Centre Feature Extensions

**Mode:** Unconstrained
**Direction:** Mission Control (existing, approved)
**Created:** 2026-04-12
**Designer Agent Session — Feature Addendum**
**Extends:** design-spec.md (original approved design)

---

## Overview

Four new features extending the existing Mission Control dashboard. All designs use the established design system (colours, typography, spacing, components from design-spec.md). No visual language changes.

---

## Feature 1: Session Transcript Panel

**Priority:** 1 (highest)
**ID:** F028
**Purpose:** See the actual conversation dialogue (user prompts + Claude responses) for any session, live, inside the Command Centre.

### Data Source

Claude Code stores session transcripts at:
```
~/.claude/projects/{encoded-project-path}/sessions/{session-id}.jsonl
```

Each line is a JSON object with message type, role, content, and timestamp. The server can tail this file and stream new lines to the dashboard via Socket.io.

The `transcript_path` field is already present in hook payloads — the server receives it on every PreToolUse event but currently ignores it.

### UX Concept

When a user clicks a session card, instead of just expanding the card's detail accordion, a **transcript panel** slides in from the right side, replacing the card grid area. This is a split view:

```
┌───────────┬──────────────────────────────────────────────┐
│ SIDEBAR   │ SESSION HEADER (name, status, stats)          │
│           ├──────────────────────────────────────────────┤
│ Sessions  │                                              │
│ list      │ TRANSCRIPT PANEL                             │
│           │ (scrollable, newest at bottom)               │
│           │                                              │
│           │ ┌──────────────────────────────────────────┐ │
│           │ │ 🧑 User                                  │ │
│           │ │ Check the test results for the API       │ │
│           │ │ endpoint changes                          │ │
│           │ ├──────────────────────────────────────────┤ │
│           │ │ 🤖 Claude                                │ │
│           │ │ I'll run the test suite now...           │ │
│           │ │                                          │ │
│           │ │ ⚙ Bash: npm run test -- --coverage      │ │
│           │ │ ✓ 42 tests passed, 0 failed              │ │
│           │ ├──────────────────────────────────────────┤ │
│           │ │ 🧑 User                                  │ │
│           │ │ Great, push it                            │ │
│           │ └──────────────────────────────────────────┘ │
│           │                                              │
│           │ ┌──────────────────────────────────────────┐ │
│           │ │ 📝 Type a message... (F029)         [⏎] │ │
│           │ └──────────────────────────────────────────┘ │
│           ├──────────────────────────────────────────────┤
│           │ ACTIVITY FEED (collapsible, as before)        │
└───────────┴──────────────────────────────────────────────┘
```

### Visual Specification

**Session Header Bar (replaces content header when session selected)**
- Background: `var(--bg-card)`, 1px bottom border
- Left: Back arrow button (← All Sessions) + status dot + session name (14px, 600 weight)
- Right: Status badge + stats (tools, files, elapsed time)
- Height: 48px

**Transcript Container**
- Background: `var(--bg-base)` (darker than cards — this is a "terminal-like" reading area)
- Padding: 16px 24px
- Overflow-y: auto, scrolls to bottom on new messages
- Auto-scroll: enabled by default, pauses when user scrolls up, resumes when scrolled back to bottom

**Message Bubbles**

| Role | Style |
|------|-------|
| User | Background: `var(--blue-dim)`, left border 2px `var(--blue)`, border-radius 8px, padding 12px 16px |
| Assistant | Background: `var(--bg-card)`, left border 2px `var(--green)`, border-radius 8px, padding 12px 16px |
| Tool Use | Background: `var(--bg-elevated)`, monospace font, left border 2px `var(--text-muted)`, border-radius 6px, padding 8px 12px. Collapsible — shows tool name + summary, expands to show full input/output |
| Tool Result | Nested inside tool use, slightly indented. Green left border for success, rose for error. Monospace. |
| System | Background: transparent, text-muted, italic, centred. For session start/end markers. |

**Message Layout**
- Role label: 11px uppercase, 500 weight, colour matches left border
- Timestamp: 11px monospace, `var(--text-muted)`, right-aligned in role header
- Content: 13px, `var(--text-primary)`, line-height 1.6
- Code blocks within content: `var(--bg-base)` background, monospace, 12px, 4px padding, 4px radius
- Gap between messages: 8px
- Tool use messages are visually distinct — smaller, more compact, clearly "system activity" not "conversation"

**Empty State (session selected but no transcript loaded)**
- Centred: "Loading transcript..." with subtle pulse animation
- Or: "Transcript unavailable" if file not found

### Transcript Loading

**No pagination, no truncation.** Load the full transcript into a scrollable container. Single session JSONL files are not large enough to warrant artificial limits. The scroller auto-follows new content (pinned to bottom) unless the user has scrolled up to read history.

**Sticky "Open in Terminal →" bar** at the top of the transcript panel — always visible regardless of scroll position. Clicking it (or clicking anywhere in the transcript body) focuses the CLI terminal window (see F030).

When F029 (text input) is built later, the input bar sits fixed at the bottom of the panel.

### Technical Architecture

**Server-side:**
1. When `handleSessionStart` or `handlePreToolUse` receives a `transcript_path`, store it on the session object
2. New API endpoint: `GET /api/sessions/:id/transcript` — reads the JSONL file, parses messages, returns as JSON array
3. New Socket.io event: `transcript-update` — emitted when new lines appear in the transcript file
4. File watching: Poll the JSONL file for new content every 2s (fs.watch on Windows/OneDrive is unreliable). Track byte offset to only read new lines.

**Client-side:**
1. When user clicks a session card, fetch `GET /api/sessions/:id/transcript`
2. Render full transcript in scrollable panel
3. Auto-scroll to bottom (pinned). If user scrolls up, pause auto-scroll. Resume when user scrolls back to bottom.
4. Listen for `transcript-update` events for the selected session — append new messages

**JSONL Parsing:**
The transcript JSONL contains various message types. Key ones to render:
- `human_turn` → User message
- `assistant_turn` → Claude response (may contain text + tool_use blocks)
- `tool_result` → Tool output
- Other types (system, metadata) → ignore or show as system messages

### Sizing / Responsive

| Breakpoint | Behaviour |
|-----------|-----------|
| > 1200px | Transcript panel takes full content width (card grid hidden when session selected) |
| 900-1200px | Same, sidebar collapses to icons |
| < 900px | Transcript panel full-width, sidebar hidden |

---

## Feature 2: Text Input to Sessions

**Priority:** 2
**ID:** F029
**Purpose:** Send text messages to a running Claude Code session from the Command Centre dashboard.

### The Problem

Current Claude Code sessions are spawned with `stdio: 'inherit'` — stdin/stdout are owned by the terminal. There is no programmatic way to inject text into a running session that was started this way.

### Viable Approaches

#### Option A: Agent SDK (Recommended)

Replace `spawn('claude')` with the Claude Agent SDK's `query()` function for sessions launched from the Command Centre. The SDK provides:
- Async iterator for output messages (stream to transcript panel)
- Programmatic input (send text to the session)
- Hook callbacks (same as HTTP hooks)
- Session resume/fork

**Trade-off:** Sessions launched this way are managed by the Command Centre server, not individual terminals. The terminal becomes the dashboard. This is a significant architectural shift — the Command Centre becomes the primary interface, not a monitoring overlay.

**Impact on existing flow:** Sessions started from the terminal (via launcher or direct `claude`) would still work as today — monitored via hooks, but no text input. Only sessions launched FROM the dashboard would support text input.

#### Option B: Named Pipes / IPC

Create a named pipe per session. A custom hook at session start creates the pipe; a custom input handler reads from it. Claude Code doesn't natively support this — would require a wrapper script.

**Trade-off:** Fragile, platform-specific, and requires modifying the session launch process. Not recommended.

#### Option C: Clipboard Bridge (Hacky)

Copy text to clipboard, simulate Ctrl+V in the session's terminal window via Win32 API. Works on Windows only. Unreliable.

**Trade-off:** Brittle, OS-specific, requires window focus management. Not recommended.

### Recommended Design: Agent SDK (Option A)

**UI for text input (bottom of transcript panel):**

```
┌──────────────────────────────────────────────────────┐
│ 📝 Type a message...                            [⏎] │
└──────────────────────────────────────────────────────┘
```

- Fixed at bottom of transcript panel (not scrollable)
- Background: `var(--bg-card)`, 1px top border, 1px outer border, 10px radius
- Input: textarea, auto-grows up to 4 lines, then scrolls internally
- Submit: Enter key (Shift+Enter for newline), or click send button
- Send button: `var(--blue)` background, arrow icon
- Disabled state: greyed out with tooltip "Text input only available for dashboard-launched sessions" for hook-monitored sessions
- Loading state: input disabled, pulsing border, "Claude is thinking..." placeholder

**Visual indicator for input-capable sessions:**
- Session cards for SDK-managed sessions get a small keyboard icon (⌨) next to the status badge
- Sidebar items get the same icon
- This distinguishes "I can talk to this session" from "I can only watch this session"

### Technical Architecture

**New dependency:** `@anthropic-ai/claude-agent-sdk`

**Server-side:**
1. New session type: `sdk-managed` vs `hook-monitored`
2. For SDK sessions: server holds the `query()` async iterator, streams messages to dashboard via Socket.io
3. New Socket.io event: `send-message` — client sends text, server feeds it to the SDK session
4. New Socket.io event: `session-output` — server streams Claude's response chunks to the client
5. SDK sessions still fire the same dashboard events (session-added, session-updated, feed-event) for consistency

**Client-side:**
1. Transcript panel shows input bar for SDK-managed sessions
2. `send-message` event sends text to server
3. `session-output` events append to transcript in real-time (streaming)

### SDK API Reference (Confirmed 2026-04-12)

The Agent SDK TypeScript API has been verified. Key patterns:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Create a new session
let sessionId: string | undefined;
for await (const message of query({
  prompt: "your prompt",
  options: { includePartialMessages: true }
})) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      // Stream text to dashboard via Socket.io
    }
  }
}

// Resume same session with new prompt
for await (const message of query({
  prompt: "follow-up message",
  options: { resume: sessionId, includePartialMessages: true }
})) {
  // Full context preserved
}
```

**Confirmed capabilities:**
- `query()` with async iterator for streaming
- `resume: sessionId` for multi-turn sessions
- `includePartialMessages: true` for token-by-token streaming
- `allowedTools` array for per-session permission control
- `permissionMode` for bulk permission policy

**Confirmed limitations:**
- Cannot pipe stdin to `claude` CLI — no interactive subprocess mode
- Cannot attach to existing terminal-launched sessions
- SDK sessions are server-managed (no terminal window)

### Dependencies

- Requires Feature 1 (transcript panel) — the input bar lives inside it
- Requires the "New Session" button (F005) to be reworked to optionally launch via SDK

---

## Feature 3: Launcher Auto-Start Server

**Priority:** 3
**ID:** F013 (existing backlog)
**Purpose:** Command Centre server starts automatically when using the launcher, so the user never has to manually run it.

### UX Flow

```
User runs launcher
  └→ Launcher checks: is localhost:4111/healthz responding?
       ├→ YES: skip, server already running
       └→ NO: spawn `node [path]/dist/index.js` as detached background process
            └→ Wait up to 3s for /healthz to respond
                 ├→ Responds: "Command Centre started ✓" (green)
                 └→ Timeout: "Command Centre failed to start" (amber, non-blocking)
```

### Launcher Integration Points

1. **Health check function:** `GET http://localhost:4111/healthz` — if 200, server is up
2. **Spawn command:** `spawn('node', [path/to/dist/index.js], { detached: true, stdio: 'ignore' })` with `unref()` so launcher can exit
3. **Path resolution:** The Command Centre install path should be stored in `launcher/config/` or derived from the project structure
4. **Display in launcher menu:** Add "Dashboard: ● Running" or "Dashboard: ○ Stopped" status line

### No Design Changes to Dashboard

This feature is entirely in the launcher. The dashboard doesn't change — it just becomes available automatically.

---

## Feature 4: New Session Button (Rework)

**Priority:** 4
**ID:** F005 (existing, needs redesign)
**Purpose:** Launch new Claude sessions from the dashboard in a way that uses the launcher's project discovery, MCP config, and harness system.

### Current Problem

The "New Session" button currently spawns raw `claude` with a manually typed project directory. This bypasses all launcher functionality (device detection, MCP server selection, harness injection, settings sync).

### Recommended Design

**Option A: Invoke Launcher (Simple)**

The dashboard's "New Session" modal opens a new terminal window running the launcher. The launcher handles project selection, config, and session launch. The new session auto-registers via hooks.

```
Dashboard "New Session" → Opens terminal → Runs launcher → User picks project → Claude starts → Hooks fire → Dashboard sees it
```

**UI change:** Replace the current form (project dir, name, prompt, perm mode) with a single button: "Open Launcher" + explanatory text. Keep the manual fields as an "Advanced" collapsible section for quick-launch without the full launcher flow.

**Modal redesign:**
```
┌────────────────────────────────────────────────┐
│  New Session                              [✕]  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  🚀  Open Launcher                       │  │
│  │  Full project selection, MCP config,     │  │
│  │  harness selection, standards sync        │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ▸ Quick Launch (advanced)                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Project directory: [___________________] │  │
│  │  Session name:      [___________________] │  │
│  │  Initial prompt:    [___________________] │  │
│  │  Permission mode:   [default ▾]           │  │
│  │                          [Launch]         │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Option B: Embed Launcher Logic (Complex)**

Port the launcher's project discovery and MCP selection into the dashboard. Fully self-contained — no terminal needed.

**Not recommended for now.** The launcher is 3,300 lines of TypeScript with device detection, MCP management, and settings sync. Embedding it creates a maintenance burden. Option A is simpler and keeps the launcher as the single source of truth.

### Visual Spec (Option A)

- "Open Launcher" button: Full-width, `var(--blue)` background, white text, 12px radius, 48px height, rocket emoji
- "Quick Launch" section: Collapsed by default, `var(--border)` top separator, click to expand
- Advanced fields: Same styling as current modal but nested under the collapsible
- When launcher is invoked: Modal closes, toast shows "Launcher opened — session will appear when started"

---

## Cross-Cutting Feature: Click-to-Terminal Focus

**ID:** F030
**Purpose:** From any session view in the dashboard, click to bring the actual CLI terminal window to the foreground.

This is the bridge between the dashboard (monitoring/overview) and the terminal (interaction). The dashboard is the "where do I need to be?" view. The terminal is the "I'm here now, working" view.

### How It Works

**Tracking terminal windows:**

When a session starts, the `SessionStart` hook payload includes `session_id`. The server needs to know which OS window/process belongs to that session.

Two scenarios:
1. **Session launched from launcher/dashboard:** We spawned the terminal — we have the PID. Store `{ sessionId → pid }` mapping.
2. **Session launched manually:** We don't know the PID. The `SessionStart` hook fires but doesn't include the terminal PID. Fallback: use the `cwd` to find matching terminal windows.

**Bringing window to front (Windows):**

```typescript
import { exec } from 'child_process';

function focusTerminalWindow(pid: number): void {
  // PowerShell: find window by PID and activate it
  exec(`powershell -Command "(New-Object -ComObject WScript.Shell).AppActivate(${pid})"`, (err) => {
    if (err) console.log('[Focus] Could not activate window for PID:', pid);
  });
}

function focusTerminalByTitle(sessionName: string): void {
  // Fallback: find window by title containing the session name or cwd
  exec(`powershell -Command "(New-Object -ComObject WScript.Shell).AppActivate('${sessionName}')"`, (err) => {
    if (err) console.log('[Focus] Could not find window for:', sessionName);
  });
}
```

**Server-side:**
- New field on Session: `terminalPid: number | null`
- Populated when session is spawned from launcher/dashboard
- For externally-started sessions: null (fallback to title matching)
- New API endpoint: `POST /api/sessions/:id/focus` — triggers the focus logic server-side
- New Socket.io event: `focus-session` — alternative to REST call

**Client-side:**

| Location | Trigger | Behaviour |
|----------|---------|-----------|
| Transcript panel | Click anywhere in transcript area (not on buttons) | Calls `POST /api/sessions/:id/focus` → server brings terminal to front |
| Transcript panel | "Open in Terminal →" link at top of panel | Same |
| Session card | Double-click | Same |
| Long messages (200+ chars) | Truncated with "... click to view in terminal →" link | Same |
| Sidebar session item | Right-click → "Focus Terminal" | Same |

**Visual cues:**
- Transcript panel has a subtle top bar: "Mirroring session — click to switch to terminal" in `var(--text-muted)`, 11px
- Cursor over transcript area: `cursor: pointer` with subtle highlight on hover
- After clicking: brief toast "Switched to terminal: [session name]"

**Limitations:**
- If the terminal window has been closed but the session is still running (e.g., session was backgrounded), focus will fail silently
- Windows Terminal tabs vs windows: `AppActivate` activates the Windows Terminal window but may not switch to the specific tab. This is a known Win32 limitation.

---

## Implementation Order

| Order | Feature | Depends On | Effort |
|-------|---------|-----------|--------|
| 1 | F028: Transcript Panel | transcript_path from hooks (already available) | Medium — server JSONL reading, new UI panel, message rendering |
| 2 | F030: Click-to-Terminal Focus | F028 (needs transcript panel to click on) | Low-Medium — PID tracking, PowerShell AppActivate, API endpoint |
| 3 | F005: New Session Rework | None | Low — modal redesign, spawn launcher in terminal |
| 4 | F013: Launcher Auto-Start | Command Centre path known to launcher | Medium — launcher code change |
| 5 | F029: Text Input (SDK sessions) | F028 + F030 working, Agent SDK | High — new dependency, session management model, streaming |

**Build now (this project):** F028, F030, F005
**Build separately (launcher project):** F013
**Build later (architectural):** F029

---

## Design Decisions (User Approved 2026-04-12)

1. **F028 (Transcript):** Load full transcript, no truncation or pagination. Scrollable container with auto-follow. Persistent "Open in Terminal →" bar at top + click-anywhere-to-focus. Dashboard mirrors the full session — user can read, scroll back, get the gist, and click through to the CLI when they need to interact.
2. **F029 (Text Input):** Text input should be available for ALL session types where technically possible. For terminal-launched sessions, the primary model is: mirror the transcript in the dashboard, click anywhere in the transcript area to bring the CLI window to front for direct interaction. Text input via Agent SDK is additive for dashboard-launched sessions, not a replacement for the click-to-terminal pattern.
3. **F005 (New Session):** Option A — invoke launcher in a new terminal window.
4. **F013 (Auto-Start):** Silently start the server. No menu option needed.
