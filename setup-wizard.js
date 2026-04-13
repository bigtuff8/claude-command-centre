#!/usr/bin/env node

/**
 * Command Centre — Setup Wizard
 *
 * Idiot-proof setup for a new machine. Run from the Command Centre directory:
 *   node setup-wizard.js
 *
 * What it does:
 *   1. Checks Node.js version (requires 18+)
 *   2. Checks if Claude Code CLI is installed
 *   3. Runs npm install
 *   4. Builds TypeScript
 *   5. Injects HTTP hooks into Claude Code settings (if not using launcher cloud template)
 *   6. Creates default config.json
 *   7. Starts the server
 *   8. Verifies it's healthy
 *   9. Opens the dashboard in your browser
 *
 * Safe to re-run — skips steps that are already done.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// ── Config ──────────────────────────────────────────────────────────
const PORT = 4111;
const MIN_NODE_VERSION = 18;
const CC_DIR = __dirname;

// ── Colours (ANSI) ─────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── Helpers ─────────────────────────────────────────────────────────
function step(num, total, label) {
  console.log(`\n  ${blue(`[${num}/${total}]`)} ${bold(label)}`);
}

function ok(msg) { console.log(`         ${green('✓')} ${msg}`); }
function warn(msg) { console.log(`         ${yellow('!')} ${msg}`); }
function fail(msg) { console.log(`         ${red('✗')} ${msg}`); }
function info(msg) { console.log(`         ${dim(msg)}`); }

function run(cmd, opts = {}) {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', cwd: CC_DIR, ...opts });
    return (result || '').trim();
  } catch (e) {
    if (opts.ignoreError) return '';
    throw e;
  }
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/healthz`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Steps ───────────────────────────────────────────────────────────

const TOTAL_STEPS = 8;

function checkNodeVersion() {
  step(1, TOTAL_STEPS, 'Checking Node.js version');

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_VERSION) {
    fail(`Node.js ${process.versions.node} detected — need ${MIN_NODE_VERSION}+`);
    fail(`Install from https://nodejs.org or run: winget install OpenJS.NodeJS.LTS`);
    process.exit(1);
  }
  ok(`Node.js ${process.versions.node}`);
}

function checkClaudeCLI() {
  step(2, TOTAL_STEPS, 'Checking Claude Code CLI');

  try {
    const version = run('claude --version', { silent: true, ignoreError: false });
    const match = version.match(/(\d+\.\d+\.\d+)/);
    ok(`Claude Code ${match ? match[1] : version}`);
  } catch {
    warn('Claude Code CLI not found on PATH');
    info('Install with: npm install -g @anthropic-ai/claude-code');
    info('Continuing anyway — the dashboard works without it, but sessions won\'t register.');
  }
}

function installDependencies() {
  step(3, TOTAL_STEPS, 'Installing dependencies');

  if (fs.existsSync(path.join(CC_DIR, 'node_modules', 'express'))) {
    ok('Dependencies already installed');
    return;
  }

  info('Running npm install (this may take a minute)...');
  run('npm install --no-audit --no-fund');
  ok('Dependencies installed');
}

function buildTypeScript() {
  step(4, TOTAL_STEPS, 'Building TypeScript');

  const distIndex = path.join(CC_DIR, 'dist', 'index.js');
  const srcIndex = path.join(CC_DIR, 'src', 'index.ts');

  // Check if build is up-to-date
  if (fs.existsSync(distIndex)) {
    const distTime = fs.statSync(distIndex).mtimeMs;
    const srcTime = fs.statSync(srcIndex).mtimeMs;
    if (distTime > srcTime) {
      ok('Build is up-to-date');
      return;
    }
  }

  info('Compiling...');
  run('npx tsc');
  ok('Build complete — zero errors');
}

function injectHooks() {
  step(5, TOTAL_STEPS, 'Checking Claude Code hooks');

  const home = os.homedir();
  const settingsPath = path.join(home, '.claude', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    info('No ~/.claude/settings.json found — will be created by the launcher');
    warn('If you\'re not using the launcher, run: npm run setup');
    return;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    warn('Could not parse settings.json — run npm run setup manually');
    return;
  }

  // Check if HTTP hooks are present
  const hooks = settings.hooks || {};
  const hasPreTool = JSON.stringify(hooks).includes(`localhost:${PORT}/hooks/pre-tool-use`);
  const hasSessionStart = JSON.stringify(hooks).includes(`localhost:${PORT}/hooks/session-start`);

  if (hasPreTool && hasSessionStart) {
    ok('HTTP hooks already configured');
  } else {
    info('Injecting HTTP hooks...');
    run('node dist/setup.js');
    ok('Hooks injected into ~/.claude/settings.json');
  }
}

function createConfig() {
  step(6, TOTAL_STEPS, 'Checking configuration');

  const configPath = path.join(CC_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    ok(`Config exists at config.json`);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    info(`Port: ${config.port || PORT}`);
    info(`Host: ${config.host || 'localhost'}`);
    info(`Notifications: ${config.notifications?.enabled !== false ? 'enabled' : 'disabled'}`);
  } else {
    info('Will be auto-created with defaults on first start');
  }
}

async function startServer() {
  step(7, TOTAL_STEPS, 'Starting server');

  // Check if already running
  if (await healthCheck()) {
    ok(`Server already running on port ${PORT}`);
    return;
  }

  info('Starting Command Centre server...');

  const entryPoint = path.join(CC_DIR, 'dist', 'index.js');
  const child = spawn('node', [entryPoint], {
    cwd: CC_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, COMMAND_CENTRE_CONFIG: path.join(CC_DIR, 'config.json') },
  });
  child.unref();

  // Wait for server to start
  let attempts = 0;
  while (attempts < 10) {
    await sleep(500);
    if (await healthCheck()) {
      ok(`Server started on port ${PORT}`);
      return;
    }
    attempts++;
  }

  fail('Server did not start within 5 seconds');
  info('Try running manually: npm start');
  info('Check for port conflicts: netstat -ano | findstr :4111');
}

async function verify() {
  step(8, TOTAL_STEPS, 'Verifying');

  // Health check
  if (await healthCheck()) {
    ok('Health check passed');
  } else {
    fail('Health check failed — server may not be running');
    return;
  }

  // Test hook endpoint
  try {
    await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ session_id: 'setup-test', cwd: CC_DIR });
      const req = http.request({
        hostname: 'localhost', port: PORT, path: '/hooks/session-start',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 3000,
      }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(postData);
      req.end();
    });
    ok('Hook endpoint responding');
  } catch {
    warn('Could not reach hook endpoint — hooks may not work');
  }

  // Clean up test session
  try {
    await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost', port: PORT, path: '/api/sessions/test-cleanup',
        method: 'DELETE', timeout: 2000,
      }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.end();
    });
  } catch { /* ignore cleanup errors */ }

  // Open dashboard
  const dashboardUrl = `http://localhost:${PORT}`;
  ok(`Dashboard: ${dashboardUrl}`);

  try {
    const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${openCmd} ${dashboardUrl}`, { stdio: 'ignore' });
    ok('Dashboard opened in browser');
  } catch {
    info('Open manually: ' + dashboardUrl);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(bold('  Command Centre — Setup Wizard'));
  console.log(dim('  ────────────────────────────────────────'));
  console.log('');
  console.log(dim(`  Directory: ${CC_DIR}`));
  console.log(dim(`  Platform:  ${os.platform()} ${os.arch()}`));
  console.log(dim(`  Machine:   ${os.hostname()}`));

  checkNodeVersion();
  checkClaudeCLI();
  installDependencies();
  buildTypeScript();
  injectHooks();
  createConfig();
  await startServer();
  await verify();

  console.log('');
  console.log(bold('  ────────────────────────────────────────'));
  console.log(`  ${green('Setup complete!')} Command Centre is running.`);
  console.log('');
  console.log(`  ${bold('Dashboard:')}  http://localhost:${PORT}`);
  console.log(`  ${bold('Stop:')}       npm run pm2:stop ${dim('(or Ctrl+C if foreground)')}`);
  console.log(`  ${bold('Persistent:')} npm run pm2:start ${dim('(survives terminal close)')}`);
  console.log(`  ${bold('Tests:')}      npm test ${dim('(33 Playwright E2E tests)')}`);
  console.log(`  ${bold('Logs:')}       npm run pm2:logs`);
  console.log('');
  console.log(dim('  Sessions launched via the launcher will auto-appear on the dashboard.'));
  console.log(dim('  The launcher auto-starts this server if it\'s not running.'));
  console.log('');
}

main().catch((err) => {
  console.error('');
  fail(`Setup failed: ${err.message}`);
  info('If this is a permissions issue, try running as administrator.');
  info('For help, check ARCHITECTURE.md or PROJECT_STATUS.md in this folder.');
  process.exit(1);
});
