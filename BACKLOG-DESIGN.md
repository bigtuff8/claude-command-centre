# Command Centre Backlog — Comprehensive Design Document

**Created:** 2026-04-16
**Scope:** All outstanding backlog items (B002 partial, B003, B008, B009, B010, B011, B012, B013, B014, B015, B016)
**Status:** Design only — no code changes

---

## 1. Groupings

### Group A: Bug Fixes (B011, B014)
Broken features that have existing code but do not work correctly. No dependencies on other items. Pure investigation and fix.

### Group B: Permission System Enhancements (B012)
Extends the existing permission holding/resolution pipeline with auto-approve capability. Touches the critical path (PreToolUse hook flow).

### Group C: Process Lifecycle (B003)
Server process management — crash recovery and boot persistence. Infrastructure-level, independent of feature work.

### Group D: Network Access & Mobile (B008, B016)
Making the dashboard accessible beyond localhost. B016 depends on B008. Shared concerns: host binding, Tailscale exposure, push notifications.

### Group E: Token/Usage Accuracy (B010)
Replacing the B007 approximation with real data. Touches transcript parsing and the usage API endpoints.

### Group F: Input Awareness (B009, B015)
Improving the dashboard's understanding of what sessions need. B009 is about file injection to sessions; B015 is about detecting when Claude is waiting for user input. Loosely related through "making dashboard-managed sessions more interactive."

### Group G: UX Evaluation (B013)
Low-priority UX review of the activity feed. No code dependency on anything else.

### Group H: Launcher Integration (B002)
Completing the "Open Launcher" path in the New Session modal.

---

## 2. Dependency Map

```
Independent (can be done in any order):
  B011 (toast click fix)
  B014 (scroll-lock fix)
  B003 (process management)
  B012 (auto-approve)
  B013 (activity feed review)
  B002 (launcher button)
  B009 (drag-and-drop testing)
  B010 (accurate tokens)
  B015 (CLI question detection)

Dependency chains:
  B008 (bind to 0.0.0.0) ──► B016 (mobile + push notifications)

Within-group sequencing:
  Group D: B008 must be done before B016
  All others are independent
```

No item depends on more than one prerequisite. The graph is shallow.

---

## 3. Item-by-Item Design

---

### B011 — Fix Toast Notification Click-to-Dashboard

**Group:** A (Bug Fixes) | **Complexity:** Medium | **Dependencies:** None

**What exists today:**
- `src/services/notifications.ts` lines 29-37: `notifyPermissionRequest` calls `notifier.notify()` with `wait: true` and a callback that checks for `response === 'activate'` then calls `openDashboard()`.
- `openDashboard()` (line 20-22) runs `exec('start "" "${dashboardUrl}"')`.
- Same pattern in `notifySessionComplete` (line 40-52) and `notifyError` (line 54-66).

**Root cause:**
`node-notifier` v10 on Windows 11 has a known issue where the `activate` callback does not reliably fire. The underlying `SnoreToast.exe` does not return the click action to the Node.js callback.

**Technical approach:**
1. Add debug logging to the callback to confirm whether it fires and what `response` value is received.
2. Test with `notifier.on('click', ...)` as an alternative event pattern.
3. If node-notifier is fundamentally broken on Win 11, alternatives:
   - **PowerShell toast** via `[Windows.UI.Notifications]` with an activation argument that triggers `start http://localhost:4111`
   - **BurntToast** PowerShell module (`New-BurntToastNotification`) — supports click actions natively
   - **Custom protocol handler** — register `commandcentre://` that maps to opening the dashboard URL
4. If switching away from node-notifier, all three notification functions must be rewritten.

**Risks:**
- Windows toast APIs are finicky. Fix may require a PowerShell dependency.
- BurntToast may not be installed on the machine.

**Files to change:** `src/services/notifications.ts`

---

### B014 — Fix Transcript Scroll-Lock

**Group:** A (Bug Fixes) | **Complexity:** Small | **Dependencies:** None

**What exists today:**
- `public/app.js` line 11: `let transcriptAutoScroll = true;` — global state, **never set to false anywhere**.
- `public/app.js` line 568: `if (wasAtBottom || transcriptAutoScroll)` — since `transcriptAutoScroll` is always `true`, this ALWAYS scrolls to bottom.

**Root cause identified:**
`transcriptAutoScroll` is initialized to `true` and never toggled. There is no scroll event listener that detects when the user scrolls up. The `wasAtBottom` check (line 533) is correct but dead code because of the `|| transcriptAutoScroll` short-circuit.

**Technical approach:**
1. Change line 568 from `if (wasAtBottom || transcriptAutoScroll)` to `if (wasAtBottom)`.
2. The `wasAtBottom` check (line 533: `scrollHeight - scrollTop - clientHeight <= 50`) already correctly detects whether the user is at the bottom.
3. First render (`transcriptRenderedCount === 0`) works fine — body has no content so it's "at bottom."
4. Optional: add a "New messages below ↓" badge when scroll-locked, clickable to jump to bottom.

**Risks:** Minimal — straightforward logic fix.

**Files to change:** `public/app.js`

---

### B012 — Auto-Approve Permissions

**Group:** B (Permission Enhancements) | **Complexity:** Small | **Dependencies:** None

**What exists today:**
- `src/services/permission.ts` line 61-64: `isAutoPassTool()` checks `config.autoPassTools` — but this only skips the dashboard prompt for tools that don't need permission (Read, Glob, etc.). It returns empty `{}`, not an active approval.
- `src/routes/hooks.ts` line 138-143: calls `isAutoPassTool()` and returns `res.json({})` for auto-pass tools.
- No `autoApproveAll` or `autoApproveTools` config exists.

**Important distinction:**
- **Auto-pass** (`isAutoPassTool`): returns `{}` — Claude handles normally (tools that don't need permission anyway).
- **Auto-approve** (this feature): returns `permissionDecision: 'allow'` — actively grants permission for tools that WOULD normally require it.

**Technical approach:**
1. Add to `AppConfig` in `src/types.ts`: `autoApproveAll?: boolean`, `autoApproveTools?: string[]`
2. Add to `DEFAULT_CONFIG` in `src/config.ts`: `autoApproveAll: false`, `autoApproveTools: []`
3. In `src/routes/hooks.ts` `handlePreToolUse()`, after the `isAutoPassTool` check (~line 145), insert:
   ```typescript
   if (config.autoApproveAll || config.autoApproveTools?.includes(toolName)) {
     broadcastFn('permission-auto-approved', { sessionId, toolName });
     res.json({
       hookSpecificOutput: {
         hookEventName: 'PreToolUse',
         permissionDecision: 'allow',
         permissionDecisionReason: 'Auto-approved via Command Centre config',
       },
     });
     return;
   }
   ```
4. Still record in activity feed for audit trail. Still broadcast to dashboard (flash-by visibility).
5. Note: `config` is not currently passed to `createHooksRouter()` — needs adding as parameter or imported.

**Risks:**
- Loses manual review safety net (user confirms this is fine — never denied a request).
- Config changes require server restart (existing behaviour, acceptable).

**Files to change:** `src/types.ts`, `src/config.ts`, `src/routes/hooks.ts`, `config.json`

---

### B003 — Server Process Management

**Group:** C (Process Lifecycle) | **Complexity:** Medium | **Dependencies:** None

**What exists today:**
- `package.json` lines 17-22: pm2 scripts defined but pm2 not installed.
- Server started by launcher as detached `node` process — survives terminal close but no crash recovery.
- `src/index.ts` lines 36-47: graceful shutdown handlers for SIGINT/SIGTERM exist.

**Option A — pm2 (recommended):**
1. Install globally: `npm install -g pm2`
2. Run `npm run pm2:start` (one-time)
3. Run `pm2 startup` to configure boot persistence (creates Windows scheduled task, needs admin elevation)
4. Update launcher's `ensureCommandCentre()` to check if pm2 is managing the process before spawning a new one (avoid double-start)

**Option B — Lightweight wrapper:**
1. Create `start-with-restart.js` that spawns the server and restarts on crash with exponential backoff
2. Use Windows Task Scheduler to run at login
3. Simpler than pm2 but no log rotation or monitoring

**Risks:**
- pm2 on Windows has historically been less reliable than on Linux
- `pm2 startup` requires admin rights — may conflict with corporate IT policies
- Launcher + pm2 could fight over the process — need coordination via healthz check

**Files to change:** `package.json`, launcher's `command-centre.ts` (coordination)

---

### B008 — Mobile-Accessible Dashboard

**Group:** D (Network & Mobile) | **Complexity:** Small | **Dependencies:** None | **Required by:** B016

**What exists today:**
- `src/config.ts` line 6: default config has `host: 'localhost'`
- `src/index.ts` line 10: `const bindHost = config.host === 'localhost' ? '127.0.0.1' : config.host;` — changing config to `'0.0.0.0'` works with no code changes
- `public/styles.css` lines 360-465: responsive CSS exists with breakpoints at 1200px, 900px, 600px

**Technical approach:**
1. Change `config.json` `host` to `"0.0.0.0"` (or Tailscale IP for remote-only)
2. Verify `<meta name="viewport">` tag in `index.html`
3. Test on real phone via local network IP / Tailscale IP
4. Fix CSS issues found (touch targets, scroll behaviour, safe area insets)

**Risks:**
- No authentication — anyone on the network can approve/deny permissions. Acceptable on home/Tailscale network.
- Safari viewport quirks may need CSS fixes.

**Files to change:** `config.json`, potentially `public/styles.css`, `public/index.html`

---

### B016 — Mobile Access with Push Notifications

**Group:** D (Network & Mobile) | **Complexity:** Large | **Dependencies:** B008

**Scope decision needed:**
- **(a) Lightweight:** Tailscale + Web Push API only
- **(b) Medium:** Integrate with Happy Coder's push notification relay for native iOS/Android alerts
- **(c) Full:** Match Happy Coder's interactivity (respond to questions, send prompts from mobile) — may make Happy Coder redundant

**Technical approach (Option A — Lightweight):**
1. B008 handles the binding. Access via `http://{tailscale-ip}:4111`
2. Add Web Push API support:
   - Generate VAPID keys (one-time, store in config)
   - Add service worker (`public/sw.js`) for push events
   - Add subscription UI ("Enable notifications" button)
   - Server-side: `web-push` npm package
   - Trigger push on: permission request, session complete, error
3. Push notification actions (approve/deny buttons IN the notification) supported by Web Push API via `NotificationEvent.action`

**Technical approach (Option B — Happy Coder):**
- POST to Happy Coder's push relay endpoint when events occur
- Native iOS/Android push without building push infra in CC
- Depends on Happy Coder being running and configured

**Risks:**
- Web Push requires HTTPS in production browsers. Tailscale provides HTTPS via MagicDNS (`https://{machine}.{tailnet}.ts.net`) but needs configuring.
- Service workers require HTTPS (except localhost)
- Option C's scope is large enough to be its own project

**Files to add:** `public/sw.js`
**Files to change:** `src/services/notifications.ts`, `src/server.ts`, `src/types.ts`, `public/app.js`, `package.json`

---

### B010 — Accurate Token Usage from CLI

**Group:** E (Token Accuracy) | **Complexity:** Medium | **Dependencies:** None

**What exists today:**
- `src/services/transcript.ts` lines 80-119: `readUsageFromTranscript()` parses JSONL looking for `entry.type === 'assistant'` with `entry.message.usage` objects. Sums `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- `src/server.ts` lines 105-135: `/api/sessions/:id/usage` and `/api/usage` endpoints.
- Pricing hardcoded: input $0.003/1K, output $0.015/1K, cache read $0.0003/1K.
- `src/services/sdk-session.ts` line 325: captures `event.total_cost_usd` from `result` event but only logs it — doesn't store or expose it.

**Technical approach:**
1. **For SDK sessions:** Capture `event.total_cost_usd` from the `result` stream event in `sdk-session.ts` and store on session object. Add `totalCostUSD` field to `Session` type.
2. **For terminal sessions:** Verify JSONL transcripts contain `usage` data by examining a real transcript file. The existing `readUsageFromTranscript()` logic may already be correct — just needs validation against real data.
3. **Update pricing:** Use `total_cost_usd` from result event for SDK sessions (model-aware). Make pricing configurable in `config.json` for terminal sessions where we only have token counts.
4. **Research needed first:** Examine a real transcript JSONL file (`~/.claude/projects/{path}/{session-id}.jsonl`) to confirm `usage` fields are present and what format they take.

**Risks:**
- Terminal session transcripts may not include `usage` blocks in all CLI versions
- `/cost` CLI command is interactive, not hookable — transcript parsing is the right approach
- Hardcoded pricing will drift as Anthropic changes model pricing

**Files to change:** `src/types.ts`, `src/services/transcript.ts`, `src/services/sdk-session.ts`, `src/server.ts`, `config.json`

---

### B009 — Drag-and-Drop Files to Sessions

**Group:** F (Input Awareness) | **Complexity:** Small | **Dependencies:** None

**What exists today:**
- `public/app.js` lines 1203-1314: full implementation exists:
  - `initDragDrop()` IIFE sets up dragover/dragleave/drop listeners on `transcriptBody`
  - File validation: max 100KB, max 3 files, text-only (`TEXT_EXTENSIONS` map)
  - `FileReader.readAsText()` reads content
  - `pendingFiles` array stores until sent
  - `renderFileIndicators()` shows attached files above input bar
  - `sendSessionMessage` monkey-patched (lines 1301-1314) to prepend file content as markdown code blocks
- **Dashboard-managed sessions only** — line 1224 checks `session.sessionType !== 'sdk-managed'`
- `public/styles.css` lines 423-430: `.drag-over` and `.file-indicator` CSS exists

**What's needed:**
Live testing with a real dashboard-managed session. Test matrix:
1. Drop a .ts file → verify indicator → send message → verify content prepended correctly
2. Drop a file with special characters in name/content
3. Drop an oversized file → verify error message
4. Drop 4+ files → verify max limit enforced
5. Drop files when no session selected / session is thinking
6. Remove a file via the indicator's remove button

**Edge case to watch:** `sendSessionMessage` monkey-patch on line 1301 captures function reference at script load. Function declarations are hoisted so this works, but if `sendSessionMessage` is ever changed to a `const`/`let` arrow function, the override breaks.

**Risks:** FileReader is async — if user drops files and presses Enter before `reader.onload` fires, files may be partially loaded. No guard for this currently.

**Files to change:** Potentially `public/app.js` (minor fixes after testing)

---

### B015 — Surface CLI Questions/Options in Dashboard

**Group:** F (Input Awareness) | **Complexity:** Medium | **Dependencies:** None

**What exists today:**
- Hooks only fire on tool use and session lifecycle. No hook for "assistant is waiting for user input."
- Terminal sessions: user must switch to terminal to respond. Dashboard shows "active" when actually blocked.
- SDK sessions: process exits after each prompt, so the dashboard already shows idle/ready state — this case is handled.

**Technical approach (for terminal sessions):**
1. Add `detectWaitingForInput(transcriptPath: string): boolean` to `src/services/transcript.ts` — reads last few JSONL lines, checks if last meaningful entry is assistant text with no following tool_use.
2. Periodically (every 5-10 seconds) check active terminal sessions for this state.
3. Add new session status or indicator: "Needs Input" (distinct from "Waiting" = permission-waiting).
4. Broadcast `session-needs-input` event when detected.
5. Dashboard shows indicator on card and sidebar item.
6. Alternative simpler heuristic: if `lastActivity` > 30 seconds old, session is `active`, and no pending permission → flag as "possibly idle."

**Risks:**
- False positives: Claude may be thinking for a long time (large codebase analysis) and appear idle.
- Transcript polling adds I/O load per active session.
- Heuristic may not be reliable for all conversation patterns.

**Files to change:** `src/services/transcript.ts`, `src/state/sessions.ts`, `src/server.ts` (polling timer), `public/app.js`, `public/styles.css`

---

### B013 — Review Activity Feed Value/UX

**Group:** G (UX Evaluation) | **Complexity:** Small | **Dependencies:** None

**What exists today:**
- Activity feed renders chronological tool-use events in the bottom panel
- Already collapsible (toggle via header click)
- `public/app.js` line 8: `let feedCollapsed = false;`

**Options:**
- **(a) Keep as-is** — no changes
- **(b) Collapse by default** — one-line change: `let feedCollapsed = true;`
- **(c) Remove entirely** — reclaim vertical space for session grid
- **(d) Enhance** — show summary stats in collapsed header ("3 sessions, 47 tools used, 2 files modified"), expand for detail

**This is a UX decision, not a code task.** User to decide.

**Files to change:** `public/app.js` (one line), potentially `public/styles.css`

---

### B002 — Complete New Session Modal (Launcher Path)

**Group:** H (Launcher Integration) | **Complexity:** Small | **Dependencies:** None

**What exists today:**
- `src/socket/handler.ts` lines 57-76: `launch-session` handler supports `viaLauncher: true`
- `src/services/spawner.ts` lines 9-15: `getLauncherCommand()` checks `process.env.CLAUDE_WORKSPACE`, falls back to `'claude'`
- Falls back to `'claude'` (the CLI, not the launcher) if env var not set — wrong behaviour

**Technical approach:**
1. Add `launcherPath` to `config.json` pointing explicitly to the launcher script
2. Update `getLauncherCommand()` fallback chain: `config.launcherPath` → `process.env.CLAUDE_WORKSPACE` → search common locations → error with helpful message
3. Add `launcherPath?: string` to `AppConfig` type and `DEFAULT_CONFIG`
4. Test: click "Open Launcher", verify launcher opens in new terminal

**Risks:**
- If launcher location changes, config needs updating
- Button should show error, not silently fail, if launcher not found

**Files to change:** `src/types.ts`, `src/config.ts`, `src/services/spawner.ts`, `config.json`

---

## 4. Suggested Phasing

Based on dependencies and complexity. **User applies their own priority layer on top.**

### Phase 1: Quick Wins
Fast to implement, clear fixes, immediate value.

| Item | Complexity | Why here |
|------|-----------|----------|
| **B014** | Small | One-line logic fix. Immediate UX win. |
| **B012** | Small | ~10 lines of server code + config. Immediate workflow improvement. |
| **B002** | Small | Config + spawner update. Completes a partial feature. |
| **B008** | Small | Config change + CSS testing. **Prerequisite for B016.** |
| **B013** | Small | UX decision + potentially one-line change. |

### Phase 2: Investigation + Testing
Items needing debugging, live testing, or research before fix is clear.

| Item | Complexity | Why here |
|------|-----------|----------|
| **B011** | Medium | Needs investigation of node-notifier on Win 11. Fix approach depends on findings. |
| **B009** | Small | Needs live testing. May surface bugs to fix. |
| **B010** | Medium | Needs transcript JSONL analysis first. Medium implementation after. |

### Phase 3: Infrastructure
New capabilities and detection systems.

| Item | Complexity | Why here |
|------|-----------|----------|
| **B003** | Medium | pm2 setup or alternative. One-time infrastructure. |
| **B015** | Medium | New polling/detection heuristic. Adds session awareness capability. |

### Phase 4: Major Feature
Significant scope, external dependencies.

| Item | Complexity | Why here |
|------|-----------|----------|
| **B016** | Large | Depends on B008. Service worker + VAPID + HTTPS. Needs scope decision first. |

---

## 5. Cross-Cutting Concerns

### Config Schema Evolution
B002, B008, B012 all add new fields to `config.json` and `AppConfig`. Coordinate to avoid multiple migrations:
- B002: `launcherPath?: string`
- B008: `host` already exists — just change default
- B012: `autoApproveAll?: boolean`, `autoApproveTools?: string[]`

All can be added to `DEFAULT_CONFIG` in a single change (config loading uses spread merge).

### Session Type Constraints
Several features are limited to specific session types:
- **B009** (drag-and-drop): Dashboard-managed sessions only
- **B015** (input detection): Primarily relevant for terminal sessions
- **B006** (hold/resume): Dashboard-managed only

The dashboard should make constraints visible (grey out inapplicable actions, show tooltips).

### Files Most Likely to Change

| File | Items |
|------|-------|
| `src/types.ts` | B002, B010, B012, B015 |
| `src/config.ts` | B002, B012 |
| `config.json` | B002, B008, B012 |
| `src/routes/hooks.ts` | B012, B015 |
| `src/services/notifications.ts` | B011, B016 |
| `src/services/transcript.ts` | B010, B015 |
| `src/services/spawner.ts` | B002 |
| `src/server.ts` | B010, B015, B016 |
| `public/app.js` | B009, B014, B015, B016 |
| `public/styles.css` | B008, B015 |
| `package.json` | B003, B016 |
