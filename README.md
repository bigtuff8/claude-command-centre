# Claude Command Centre

Web dashboard for monitoring and managing multiple [Claude Code](https://claude.ai/claude-code) sessions from a single view.

See all your running sessions at a glance. Approve or deny permissions from the dashboard instead of switching terminals. Get desktop notifications when sessions need attention. Send messages to dashboard-managed sessions. Track token usage and costs.

## Quick Start

```bash
git clone https://github.com/bigtuff8/claude-command-centre
cd claude-command-centre
node setup-wizard.js
```

The wizard handles everything: installs dependencies, builds, injects hooks, starts the server, and opens the dashboard.

**See [INSTALL.md](INSTALL.md) for detailed setup instructions** (your own machines vs colleague installs).

## Features

- **Real-time session monitoring** — all active Claude Code sessions on one screen
- **Permission approve/deny** — respond to permission prompts from the dashboard (30s timeout, falls through to terminal)
- **Desktop toast notifications** — Windows notifications when sessions need attention
- **Session transcript** — view the full conversation for any session, live
- **Text input** — send messages to dashboard-managed sessions directly from the browser
- **Click-to-terminal** — switch to the CLI terminal window with one click
- **Session kill** — stop sessions from the dashboard with confirmation dialog
- **Session hold** — pause dashboard-managed sessions (auto-declines permissions)
- **Token/cost tracking** — per-session and aggregate token usage with cost estimates
- **New Session launcher** — start sessions via the full launcher or quick dashboard-managed mode
- **Drag-and-drop files** — drop text files onto the transcript to include in your next message
- **Mobile responsive** — usable on phone/tablet via Tailscale
- **Rename sessions** — double-click to rename any session
- **Dismiss completed sessions** — clean up finished sessions from the view

## How It Works

```
Claude Code sessions  ──HTTP hooks──>  Command Centre server  ──WebSocket──>  Dashboard (browser)
                                       (Express + Socket.io)
                                       0.0.0.0:4111
```

Claude Code fires HTTP hooks on session start, tool use, permission requests, and session end. The Command Centre server receives these events, tracks session state in memory, and broadcasts updates to the dashboard via Socket.io.

For permission requests, the server holds the HTTP response open until you click Approve/Deny on the dashboard (or the 30s timeout expires, falling through to the CLI prompt).

## Requirements

- **Node.js 18+**
- **Claude Code CLI** installed and on PATH
- **Windows 10/11** (primary target — macOS/Linux should work but less tested)

## Project Structure

```
claude-command-centre/
  src/                  TypeScript server source
  public/               Dashboard frontend (HTML/CSS/JS)
  tests/                Playwright E2E tests (33 tests)
  prototype/            Interactive design prototype
  setup-wizard.js       One-command setup for new machines
  config.json           Runtime config (auto-created, gitignored)
```

## Configuration

`config.json` is auto-created on first run with these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `host` | `"0.0.0.0"` | Bind address. `"0.0.0.0"` for network/Tailscale access, `"localhost"` for local only |
| `port` | `4111` | Server port |
| `permissionTimeoutSeconds` | `30` | How long to wait for dashboard approval before falling through to CLI |
| `notifications.enabled` | `true` | Windows toast notifications |
| `notifications.sound` | `true` | Notification sound |
| `autoPassTools` | `["Read","Glob","Grep","WebSearch","WebFetch"]` | Tools that bypass the dashboard permission prompt (no permission needed) |
| `autoApproveAll` | `false` | Auto-approve ALL permission requests (no dashboard interaction) |
| `autoApproveTools` | `[]` | Auto-approve specific tools (e.g. `["Bash","Edit"]`) |
| `launcherPath` | `""` | Explicit path to launcher index.js (auto-detected if empty) |
| `maxEventsPerSession` | `200` | Event buffer per session |
| `maxTotalFeedEvents` | `500` | Total activity feed buffer |
| `openBrowser` | `true` | Auto-open dashboard on server start |

## Running Tests

```bash
# Server must be running first
npm start &
npm test          # 33 Playwright E2E tests
npm run test:headed  # Watch tests run in browser
```

## npm Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Start server (foreground) |
| `npm run build` | Compile TypeScript |
| `npm run setup` | Inject HTTP hooks into Claude Code settings |
| `npm run setup:wizard` | Full setup wizard (recommended for first run) |
| `npm test` | Run Playwright tests |
| `npm run pm2:start` | Start with pm2 (persistent, survives terminal close) |
| `npm run pm2:stop` | Stop pm2 process |
| `npm run pm2:logs` | View pm2 logs |

## License

MIT
