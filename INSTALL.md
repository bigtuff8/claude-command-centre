# Installation Guide

Two scenarios covered here:

1. **Your own machine** (e.g., your desktop) — you already have the launcher, OneDrive, and Claude Code set up
2. **A colleague's machine** — standalone install, no launcher, no OneDrive

---

## Scenario 1: Your Own Machine (Desktop, Laptop, etc.)

### Prerequisites

You already have these from your existing setup:

- Node.js 18+ (`node --version` to check)
- Claude Code CLI (`claude --version` to check)
- The launcher set up at `claude-workspace/launcher/`
- OneDrive syncing `Projects/Work/`

### Steps

The project files are already on your machine via OneDrive sync. Just run the wizard:

```bash
cd "C:/Users/YourName/OneDrive - Airedale Catering Equipment/Projects/Work/Claude Agents/Command Centre"
node setup-wizard.js
```

That's it. The wizard:

1. Checks Node.js version
2. Checks Claude Code CLI
3. Installs npm dependencies
4. Builds TypeScript
5. Checks/injects HTTP hooks into `~/.claude/settings.json`
6. Creates default `config.json`
7. Starts the server
8. Verifies everything works
9. Opens the dashboard in your browser

### What happens automatically after setup

- **The launcher auto-starts the server** on every launch (B001). You don't need to manually start it again.
- **HTTP hooks are in the cloud template** (`claude-workspace/launcher/config/claude-settings.json`). They sync to all your machines via the launcher's settings sync. They won't disappear.
- **New Claude Code sessions register automatically** via hooks. Open the dashboard at `http://localhost:4111` to see them.

### If the launcher isn't set up on this machine yet

Add the machine to `claude-workspace/launcher/config/devices.json`:

```json
{
  "YOUR-HOSTNAME": {
    "personalProjectsPath": "C:/Users/YourName/OneDrive/Projects/Personal",
    "workProjectsPath": "C:/Users/YourName/OneDrive - Airedale Catering Equipment/Projects/Work",
    "workspacePath": "C:/Users/YourName/OneDrive - Airedale Catering Equipment/Projects/claude-workspace",
    "description": "Your machine description"
  }
}
```

Then build the launcher: `cd claude-workspace/launcher && npm install && npx tsc`

### Persistent server (optional)

If you want the server to survive terminal closures and auto-restart on crash:

```bash
# Install pm2 globally (one time)
npm install -g pm2

# Start with pm2
npm run pm2:start

# Auto-start on Windows login (one time)
npm run pm2:startup
```

### Updating

When you pull new changes (or they sync via OneDrive):

```bash
cd "Command Centre"
npm install    # in case dependencies changed
npm run build  # recompile TypeScript
# Restart the server (pm2 auto-restarts, or manually: npm start)
```

Or just re-run the wizard — it skips steps that are already done:

```bash
node setup-wizard.js
```

---

## Scenario 2: Colleague Install (Standalone)

### Prerequisites

Your colleague needs:

- **Node.js 18+** — download from https://nodejs.org or `winget install OpenJS.NodeJS.LTS`
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code` (they need an Anthropic API key or Claude Max subscription)
- **Git** — for cloning the repo

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/bigtuff8/claude-command-centre
cd claude-command-centre

# 2. Run the setup wizard
node setup-wizard.js
```

The wizard handles everything. When it finishes, the dashboard is running at `http://localhost:4111`.

### What the wizard does for a colleague

1. Installs npm dependencies (`npm install`)
2. Builds the TypeScript source (`npx tsc`)
3. Injects 4 HTTP hooks into their `~/.claude/settings.json` (preserves existing settings)
4. Creates a default `config.json`
5. Starts the server on `localhost:4111`
6. Verifies the server is healthy
7. Opens the dashboard in their browser

### How their sessions appear on the dashboard

After setup, every new Claude Code session fires HTTP hooks to the Command Centre server. Sessions appear on the dashboard automatically. No further configuration needed.

**Important:** Only sessions started AFTER the hooks are injected will appear. Existing running sessions won't retroactively register.

### Starting the server (after a reboot)

The server doesn't auto-start without the launcher. After a reboot, your colleague needs to either:

**Option A: Re-run the wizard** (easiest — it skips everything already done and just starts the server):
```bash
cd claude-command-centre
node setup-wizard.js
```

**Option B: Start manually:**
```bash
cd claude-command-centre
npm start
```

**Option C: Use pm2 for auto-start** (recommended for regular users):
```bash
# One-time setup
npm install -g pm2
npm run pm2:start
npm run pm2:startup   # auto-start on login
```

### Updating

```bash
cd claude-command-centre
git pull
npm install
npm run build
# Restart: re-run wizard, or npm start, or npm run pm2:restart
```

### No launcher? No problem

The Command Centre works entirely standalone. The launcher integration (auto-start, settings sync) is a convenience for users who have the Airedale launcher set up. Without it:

- HTTP hooks are injected by the setup wizard instead of the cloud template
- The server needs manual starting (or pm2)
- The "Open Launcher" button in the New Session modal won't work — use "Quick Session" instead
- Everything else works identically

---

## Troubleshooting

### Server won't start

```bash
# Check if something else is using port 4111
netstat -ano | findstr :4111

# If so, kill it by PID
taskkill /F /PID <the_pid>

# Or change the port in config.json
```

### Sessions don't appear on the dashboard

1. **Check hooks are configured:** Look in `~/.claude/settings.json` for `localhost:4111` URLs
2. **Check server is running:** `curl http://localhost:4111/healthz` should return `{"status":"ok"}`
3. **Hooks only apply to NEW sessions.** Restart your Claude Code session after setup.
4. **Re-run the wizard:** `node setup-wizard.js` — it re-injects hooks if missing

### Permission approve/deny doesn't work

- The server holds the HTTP response for 30 seconds. If you don't click Approve/Deny in time, it falls through to the CLI terminal prompt.
- Check that the `PreToolUse` hook has `"timeout": 30` in your settings.json
- Read-only tools (Read, Glob, Grep) are auto-passed and won't show permission prompts

### Dashboard shows "Disconnected"

The WebSocket connection dropped. This happens if the server restarts. The dashboard auto-reconnects with exponential backoff. Click "Retry Now" if you're impatient.

### Toast notifications don't appear (Windows)

- Check `config.json` has `"notifications": { "enabled": true }`
- Windows Focus Assist may be suppressing them — check notification settings
- The `node-notifier` package needs `node-notifier` binaries in node_modules — re-run `npm install`

### Mobile access via Tailscale

1. Edit `config.json`: set `"host": "0.0.0.0"`
2. Restart the server
3. Access via your Tailscale IP: `http://<tailscale-ip>:4111`
4. Both devices must be on the same Tailscale network

---

## Architecture Overview

For full technical details, see [ARCHITECTURE.md](ARCHITECTURE.md).

```
┌──────────────────────────────────────────────────────────────────┐
│                    YOUR MACHINE                                   │
│                                                                   │
│  Claude Code Sessions ──HTTP hooks──> Command Centre Server       │
│  (terminal windows)                   (Express + Socket.io)       │
│                                       localhost:4111              │
│                                            │                      │
│                                       Socket.io broadcast         │
│                                            │                      │
│                                            ▼                      │
│                                       Dashboard (browser)         │
│                                       http://localhost:4111       │
│                                                                   │
│  Windows Toast Notifications (node-notifier)                      │
└──────────────────────────────────────────────────────────────────┘
```
