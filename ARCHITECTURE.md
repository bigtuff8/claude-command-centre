# Command Centre — Technical Architecture

**Created:** 2026-04-12
**Updated:** 2026-04-12

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    USER'S MACHINE                                │
│                                                                  │
│  ┌─────────────┐     HTTP POST (hooks)     ┌──────────────────┐ │
│  │ Claude Code  │ ──────────────────────── │  Command Centre  │ │
│  │ Session 1    │                           │  Server          │ │
│  ├─────────────┤     HTTP POST (hooks)     │  (Express)       │ │
│  │ Claude Code  │ ──────────────────────── │                  │ │
│  │ Session 2    │                           │  Port: 4111      │ │
│  ├─────────────┤     HTTP POST (hooks)     │                  │ │
│  │ Claude Code  │ ──────────────────────── │  ┌────────────┐  │ │
│  │ Session N    │                           │  │ Session    │  │ │
│  └─────────────┘                           │  │ State Store│  │ │
│        ▲                                    │  │ (in-memory)│  │ │
│        │ spawn (terminal window)            │  └────────────┘  │ │
│        │                                    │        │         │ │
│  ┌─────┴───────┐                           │        │ Socket  │ │
│  │ Launcher    │                            │        │ .io     │ │
│  │ (existing)  │                            │        ▼         │ │
│  └─────────────┘                           │  ┌────────────┐  │ │
│                                             │  │ WebSocket  │  │ │
│  ┌─────────────────────────────────────┐   │  │ broadcast  │  │ │
│  │ Browser: http://localhost:4111      │   │  └────────────┘  │ │
│  │ ┌─────────────────────────────────┐ │   └──────────────────┘ │
│  │ │ Dashboard (HTML/CSS/JS)         │ │           │            │
│  │ │ Socket.io client ◄──────────────┼─┼───────────┘            │
│  │ └─────────────────────────────────┘ │                        │
│  └─────────────────────────────────────┘                        │
│                                                                  │
│  ┌─────────────────────────────────────┐                        │
│  │ Windows Toast Notifications         │                        │
│  │ (node-notifier, triggered by server)│                        │
│  └─────────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Session Registers (SessionStart hook)

```
Claude Code starts → fires SessionStart hook → POST to localhost:4111/hooks
Server creates session record in memory → broadcasts "session-added" via Socket.io
Dashboard receives event → renders new session card
```

### 2. Tool Activity (PostToolUse hook)

```
Claude uses a tool → fires PostToolUse hook → POST to localhost:4111/hooks
Server updates session's last activity, tool count → broadcasts "session-updated"
Dashboard updates card + appends to activity feed
```

### 3. Permission Request (PreToolUse hook) — THE CRITICAL PATH

```
Claude wants to use a tool → fires PreToolUse hook → POST to localhost:4111/hooks
Server detects tool needs permission → sets session status to "waiting"
Server broadcasts "permission-requested" via Socket.io
Dashboard shows permission bar with Approve/Deny buttons
Desktop toast notification fires

** Server holds the HTTP response open (does NOT respond yet) **

User clicks Approve on dashboard →
  Dashboard sends "permission-response" via Socket.io to server →
  Server responds to the held HTTP request with:
  {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "Approved via Command Centre dashboard"
    }
  }
  → Claude Code receives 200 + allow → proceeds with tool execution

OR user clicks Deny →
  Same flow but with "permissionDecision": "deny"

OR timeout (configurable, default 30s) →
  Server responds with "permissionDecision": "ask" (falls through to terminal prompt)
  Dashboard shows "Timed out — check terminal" toast
```

### 4. Session Ends (SessionEnd hook)

```
Claude session exits → fires SessionEnd hook → POST to localhost:4111/hooks
Server sets session status to "completed" → broadcasts "session-ended"
Dashboard updates card to completed state (greyed out)
Desktop toast: "Session completed: [name]"
```

---

## Hook Configuration

Added to `~/.claude/settings.json` (deployed via launcher's settings sync):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4111/hooks/pre-tool-use",
            "timeout": 60
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4111/hooks/post-tool-use"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4111/hooks/session-start"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:4111/hooks/session-end"
          }
        ]
      }
    ]
  }
}
```

**Important:** If the Command Centre server is not running, all hooks return connection errors (non-2xx), which Claude Code treats as non-blocking — sessions continue normally. The hooks are safe to leave configured even when the dashboard isn't running.

---

## Hook Payloads

### Inbound (Claude Code → Server)

**PreToolUse:**
```json
{
  "session_id": "uuid-here",
  "transcript_path": "/path/to/.claude/projects/.../transcript.jsonl",
  "cwd": "/path/to/project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm run test -- --coverage",
    "description": "Run test suite with coverage"
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

**PostToolUse:**
```json
{
  "session_id": "uuid-here",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file.cs",
    "old_string": "...",
    "new_string": "..."
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

**SessionStart / SessionEnd:**
```json
{
  "session_id": "uuid-here",
  "hook_event_name": "SessionStart",
  "cwd": "/path/to/project",
  "permission_mode": "default"
}
```

### Outbound (Server → Claude Code)

**PreToolUse response (approve):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Approved via Command Centre"
  }
}
```

**PreToolUse response (deny):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Denied via Command Centre"
  }
}
```

**PreToolUse response (pass-through to terminal):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask"
  }
}
```

**PostToolUse / SessionStart / SessionEnd response:**
```json
{}
```
(Acknowledge immediately — these are fire-and-forget notifications.)

---

## Server Architecture

### Project Structure

```
command-centre/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              ← Entry point: start Express + Socket.io server
│   ├── server.ts             ← Express app setup, route mounting, Socket.io init
│   ├── routes/
│   │   └── hooks.ts          ← POST /hooks/* endpoints (receives Claude Code events)
│   ├── state/
│   │   └── sessions.ts       ← In-memory session state store (Map<sessionId, Session>)
│   ├── services/
│   │   ├── permission.ts     ← Permission request holding + resolution (the critical path)
│   │   ├── notifications.ts  ← Windows toast notifications via node-notifier
│   │   └── spawner.ts        ← Launch new Claude Code sessions (child_process.spawn)
│   ├── socket/
│   │   └── handler.ts        ← Socket.io event handlers (permission-response, etc.)
│   ├── config.ts             ← Config loading (port, settings, paths)
│   └── types.ts              ← TypeScript interfaces for hook payloads, session state
├── public/                    ← Static dashboard files (served by Express)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── config.json                ← User config (auto-created with defaults on first run)
└── setup.js                   ← CLI setup script: injects hook config into Claude settings
```

### Key Dependencies

```json
{
  "dependencies": {
    "express": "^4.x",
    "socket.io": "^4.x",
    "node-notifier": "^10.x",
    "open": "^10.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/express": "^4.x",
    "@types/node": "^20.x"
  }
}
```

Deliberately minimal. No database, no ORM, no build framework for the frontend.

### In-Memory Session State

```typescript
interface Session {
  id: string;                    // session_id from Claude Code
  name: string;                  // --name flag or derived from cwd
  project: string;               // cwd from hook payload
  status: 'active' | 'waiting' | 'completed' | 'errored';
  startedAt: Date;
  lastActivity: Date;
  toolCount: number;
  filesModified: Set<string>;
  events: HookEvent[];           // last N events (ring buffer, max 200 per session)
  pendingPermission: PendingPermission | null;
}

interface PendingPermission {
  toolName: string;
  toolInput: any;
  toolUseId: string;
  receivedAt: Date;
  resolve: (response: HookResponse) => void;  // resolves the held HTTP response
  timeout: NodeJS.Timeout;                      // auto-resolves with "ask" on timeout
}
```

State is in-memory only. Sessions are lost on server restart — this is acceptable because the server will rediscover active sessions from new hook events.

---

## Permission Holding Pattern (Critical Path Detail)

This is the most complex part of the system. The server must hold an HTTP response open while waiting for user input from the dashboard.

```typescript
// In routes/hooks.ts
app.post('/hooks/pre-tool-use', async (req, res) => {
  const event = req.body;
  const session = getOrCreateSession(event.session_id, event.cwd);

  // Check if this tool actually needs permission prompting
  // (Read, Glob, Grep typically don't — they're pre-approved)
  if (isAutoApproved(event.tool_name, session)) {
    return res.json({});  // Let Claude handle it normally
  }

  // Create a Promise that resolves when user clicks Approve/Deny
  const permissionPromise = new Promise<HookResponse>((resolve) => {
    const timeout = setTimeout(() => {
      // Timeout: fall through to terminal prompt
      resolve({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask'
        }
      });
      session.pendingPermission = null;
      broadcast('permission-timeout', { sessionId: session.id });
    }, PERMISSION_TIMEOUT_MS);

    session.pendingPermission = {
      toolName: event.tool_name,
      toolInput: event.tool_input,
      toolUseId: event.tool_use_id,
      receivedAt: new Date(),
      resolve,
      timeout
    };
  });

  session.status = 'waiting';
  broadcast('permission-requested', {
    sessionId: session.id,
    toolName: event.tool_name,
    toolInput: event.tool_input
  });
  sendDesktopNotification(session.name, event.tool_name, event.tool_input);

  // Hold the HTTP response until user responds or timeout
  const response = await permissionPromise;
  res.json(response);
});
```

```typescript
// In socket/handler.ts — when user clicks Approve/Deny in dashboard
socket.on('permission-response', ({ sessionId, decision, reason }) => {
  const session = getSession(sessionId);
  if (!session?.pendingPermission) return;

  clearTimeout(session.pendingPermission.timeout);
  session.pendingPermission.resolve({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,  // 'allow' or 'deny'
      permissionDecisionReason: reason || `${decision === 'allow' ? 'Approved' : 'Denied'} via Command Centre`
    }
  });

  session.pendingPermission = null;
  session.status = 'active';
  broadcast('permission-resolved', { sessionId, decision });
});
```

---

## Auto-Approve Logic

Not every `PreToolUse` event needs to show a permission prompt on the dashboard. Read-only tools are typically pre-approved in Claude Code settings. The server should only hold requests for tools that would actually prompt the user:

```typescript
// Tools that are typically pre-approved and should pass through
const AUTO_PASS_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch'];

function isAutoApproved(toolName: string, session: Session): boolean {
  // If the tool is in the auto-pass list, don't hold it
  if (AUTO_PASS_TOOLS.includes(toolName)) return true;

  // If the session's permission_mode is 'bypassPermissions', don't hold it
  if (session.permissionMode === 'bypassPermissions') return true;

  return false;
}
```

The server still receives the hook event (for activity tracking) but responds immediately with an empty `{}` body, letting Claude Code handle it normally.

---

## Desktop Notifications

```typescript
import notifier from 'node-notifier';

function sendDesktopNotification(sessionName: string, toolName: string, toolInput: any) {
  const inputSummary = toolName === 'Bash'
    ? toolInput.command?.substring(0, 80)
    : toolInput.file_path || JSON.stringify(toolInput).substring(0, 80);

  notifier.notify({
    title: `${sessionName} needs permission`,
    message: `${toolName}: ${inputSummary}`,
    sound: true,
    wait: false,
    appID: 'Command Centre'
  });
}
```

---

## Session Spawning (New Session from Dashboard)

```typescript
import { spawn } from 'child_process';

function spawnSession(projectDir: string, name: string, prompt?: string) {
  // Detect OS for terminal command
  const isWindows = process.platform === 'win32';

  const args = ['claude'];
  if (name) args.push('--name', name);
  if (prompt) args.push(prompt);

  if (isWindows) {
    // Open in a new Windows Terminal tab/window
    spawn('cmd', ['/c', 'start', 'cmd', '/k', args.join(' ')], {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore'
    });
  } else {
    // macOS/Linux: open in default terminal
    spawn('open', ['-a', 'Terminal', '--args', ...args], {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore'
    });
  }
}
```

---

## Configuration (config.json)

Auto-created with defaults on first run:

```json
{
  "port": 4111,
  "permissionTimeoutSeconds": 60,
  "notifications": {
    "enabled": true,
    "sound": true
  },
  "autoPassTools": ["Read", "Glob", "Grep", "WebSearch"],
  "maxEventsPerSession": 200,
  "maxTotalEvents": 500
}
```

---

## Setup / Installation Flow

```
npm install -g command-centre   (or npx command-centre)
                │
                ▼
        command-centre setup     ← Injects hook config into ~/.claude/settings.json
                │                  (preserves existing settings, merges hooks)
                ▼
        command-centre           ← Starts server + opens dashboard in browser
```

The `setup` command:
1. Finds `~/.claude/settings.json`
2. Reads existing content (preserves permissions, env, etc.)
3. Merges hook entries for SessionStart, PreToolUse, PostToolUse, SessionEnd
4. Writes back
5. Reports what was added

---

## Launcher Integration (Optional, Future)

For users of the Airedale launcher, the hook config can be added to `claude-settings.json` (the cloud template) instead of running `setup`. The launcher's existing settings sync deploys it automatically to all devices.

Additionally, the launcher could:
- Start the Command Centre server as part of its startup sequence
- Add a "Open Dashboard" option to the launcher menu
- Pass session names via `--name` when spawning Claude (for better dashboard labelling)

These are enhancements, not requirements. The Command Centre works standalone.

---

## Security Considerations

- **Local only.** Server binds to `localhost` (127.0.0.1), not `0.0.0.0`. Not accessible from network.
- **No authentication** for local access (same as Claude Code itself).
- **Hook payloads may contain file paths and code.** These stay in-memory, never persisted to disk, never transmitted off-machine.
- **Permission decisions are safety-critical.** The dashboard must clearly show what tool and input is being approved. Truncation of tool input must preserve enough context for informed decisions.
- **Timeout fallback is "ask" (not "allow").** If the dashboard doesn't respond in time, Claude Code falls through to its normal terminal prompt. Never auto-approves on timeout.

---

## Failure Modes

| Scenario | Behaviour |
|----------|-----------|
| Server not running | Hooks return connection error → Claude Code treats as non-blocking → sessions work normally in terminal |
| Server crashes mid-session | Same as above — hooks fail gracefully, sessions continue |
| Dashboard not open but server running | Server still receives events, stores state, sends desktop notifications. Dashboard reconnects when opened. |
| Multiple dashboards open | All receive updates via Socket.io broadcast. Permission response from any dashboard resolves the request. |
| Permission timeout | Server responds with `"ask"` → Claude Code shows terminal prompt as normal |
| Session starts before server | Server creates session record on first hook event received (not just SessionStart) |
