# Command Centre — Data Dictionary

**Last Updated:** 2026-04-13

## Session State (in-memory, tracked by server)

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `sessionId` | string (UUID) | Claude Code hook payload `session_id` | Unique session identifier |
| `sessionName` | string | Derived from `cwd` folder name, or user-renamed | Human-readable label shown on cards and sidebar |
| `sessionProject` | string | Hook payload `cwd` | Working directory path of the session |
| `sessionStatus` | enum | Derived from events | `active`, `waiting`, `held`, `completed`, `errored`, `stopped` |
| `sessionType` | enum | Set on creation | `hook-monitored` (terminal) or `sdk-managed` (dashboard-managed) |
| `sessionPermissionMode` | string | Hook payload `permission_mode` | Claude Code permission mode (default, acceptEdits, bypassPermissions) |
| `sessionStartedAt` | Date | SessionStart event | When the session began |
| `sessionLastActivity` | Date | Any event | Most recent event timestamp |
| `sessionToolCount` | number | Incremented on PostToolUse | Total tools invoked in session |
| `sessionFilesModified` | Set\<string\> | Edit/Write tool events | Files changed by the session |
| `sessionTranscriptPath` | string\|null | Hook payload `transcript_path` or auto-derived | Path to JSONL transcript file |
| `sessionTerminalPid` | number\|null | Set on spawn | OS process ID (for click-to-terminal and kill) |

## Hook Events (HTTP payloads from Claude Code)

| Field | Type | Present In | Purpose |
|-------|------|-----------|---------|
| `hookSessionId` | string | All hooks | Maps to `sessionId` |
| `hookTranscriptPath` | string | PreToolUse, SessionStart | Path to transcript JSONL |
| `hookCwd` | string | SessionStart, PreToolUse | Working directory |
| `hookPermissionMode` | string | SessionStart | Permission mode |
| `hookEventName` | string | All hooks | `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd` |
| `hookToolName` | string | PreToolUse, PostToolUse | Tool name (Read, Edit, Bash, etc.) |
| `hookToolInput` | object | PreToolUse, PostToolUse | Tool parameters |
| `hookToolUseId` | string | PreToolUse, PostToolUse | Unique tool invocation ID |

## Hook Response (server → Claude Code)

| Field | Type | When | Purpose |
|-------|------|------|---------|
| `permissionDecision` | enum | PreToolUse response | `allow`, `deny`, `ask`, `defer` |
| `permissionDecisionReason` | string | PreToolUse response | Human-readable reason shown to Claude |
| `updatedInput` | object | PreToolUse response (optional) | Modified tool input |

## Pending Permission (held HTTP request)

| Field | Type | Purpose |
|-------|------|---------|
| `pendingToolName` | string | Tool requesting permission |
| `pendingToolInput` | object | Tool parameters |
| `pendingToolUseId` | string | Tool invocation ID |
| `pendingReceivedAt` | Date | When the request arrived |
| `pendingResolve` | function | Resolves the held HTTP response |
| `pendingTimeout` | NodeJS.Timeout | Auto-resolves with `ask` after timeout |

## Token Usage (extracted from transcript JSONL)

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `usageInputTokens` | number | `assistant.message.usage.input_tokens` | Input tokens consumed |
| `usageOutputTokens` | number | `assistant.message.usage.output_tokens` | Output tokens generated |
| `usageCacheReadTokens` | number | `assistant.message.usage.cache_read_input_tokens` | Cached input tokens |
| `usageCacheCreationTokens` | number | `assistant.message.usage.cache_creation_input_tokens` | Cache creation tokens |
| `usageTotalTokens` | number | Sum of above | Total tokens |
| `usageEstimatedCostUSD` | number | Calculated from pricing | Estimated cost in USD |

## Activity Feed Events (broadcast to dashboard)

| Field | Type | Purpose |
|-------|------|---------|
| `feedTimestamp` | ISO string | When the event occurred |
| `feedSessionId` | string | Which session |
| `feedSessionName` | string | Session display name |
| `feedEventName` | string | Event type (PreToolUse, PostToolUse, SessionStart, SessionEnd) |
| `feedToolName` | string\|undefined | Tool name if applicable |
| `feedDetail` | string\|undefined | Human-readable event summary |

## Configuration (config.json)

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `configHost` | string | `"localhost"` | Server bind address (`localhost`, `0.0.0.0`, or specific IP) |
| `configPort` | number | `4111` | Server port |
| `configPermissionTimeoutSeconds` | number | `30` | Dashboard approval timeout before CLI fallthrough |
| `configNotificationsEnabled` | boolean | `true` | Windows toast notifications on/off |
| `configNotificationsSound` | boolean | `true` | Notification sound on/off |
| `configAutoPassTools` | string[] | `["Read","Glob","Grep","WebSearch","WebFetch"]` | Tools that bypass dashboard permission prompt |
| `configMaxEventsPerSession` | number | `200` | Max events stored per session |
| `configMaxTotalFeedEvents` | number | `500` | Max events in the activity feed |
| `configOpenBrowser` | boolean | `true` | Auto-open dashboard on server start |

## Transcript Messages (parsed from JSONL for display)

| Field | Type | Purpose |
|-------|------|---------|
| `transcriptType` | enum | `user`, `assistant`, `tool_use`, `tool_result`, `system` |
| `transcriptText` | string | Message content |
| `transcriptToolName` | string\|undefined | Tool name for tool_use/tool_result types |
| `transcriptToolId` | string\|undefined | Tool invocation ID |
| `transcriptTimestamp` | string\|undefined | ISO timestamp |
