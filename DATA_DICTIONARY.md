# Command Centre — Data Dictionary

**Last Updated:** 2026-04-11

## Session Events (received via HTTP hooks from Claude Code)

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `eventType` | string | Claude Code hook payload | Event name (PermissionRequest, SessionEnd, PostToolUse, etc.) |
| `sessionId` | string (UUID) | Claude Code hook payload | Unique session identifier |
| `sessionName` | string | Claude Code `--name` flag | Human-readable session label |
| `projectPath` | string | Claude Code hook payload | Working directory of the session |
| `timestamp` | ISO datetime | Claude Code hook payload | When the event occurred |
| `toolName` | string | PreToolUse/PostToolUse payload | Which tool was invoked (Read, Edit, Bash, etc.) |
| `toolInput` | object | PreToolUse payload | Tool parameters (may be truncated for display) |

## Session State (tracked by Command Centre server)

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `sessionStatus` | enum | Derived from events | Current state: active, waiting_for_input, waiting_for_permission, completed, errored |
| `sessionStartedAt` | ISO datetime | SessionStart event | When the session began |
| `sessionLastActivity` | ISO datetime | Any event | Most recent event timestamp |
| `sessionTokensUsed` | number | Accumulated from events | Total tokens consumed (if available in payload) |
| `sessionCostUsd` | number | Calculated | Estimated cost based on token usage |
| `pendingPermission` | object | PermissionRequest event | Details of the permission being requested (tool, input, reason) |

## Configuration (portable across machines)

| Field | Type | Location | Purpose |
|-------|------|----------|---------|
| `serverPort` | number | config.json | Port for the Command Centre server (default: TBD) |
| `notificationsEnabled` | boolean | config.json | Whether to show Windows toast notifications |
| `hookEndpoint` | string | Derived | URL that Claude Code HTTP hooks POST to |
| `dashboardUrl` | string | Derived | URL for the web dashboard |
