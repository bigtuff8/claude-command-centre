#!/usr/bin/env node

/**
 * Command Centre Auto-Updater
 * Pulls latest from GitHub, installs deps if changed, rebuilds, and restarts the server.
 * Designed to run on boot (before watchdog) or on a schedule.
 *
 * Usage:
 *   node scripts/auto-update.js           — pull, build, exit (let watchdog handle restart)
 *   node scripts/auto-update.js --start   — pull, build, then start watchdog
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'data');
const LOG_FILE = path.join(LOG_DIR, 'update.log');
const LOCKFILE = path.join(ROOT, 'package-lock.json');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  try {
    const output = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 120000, ...opts });
    return { ok: true, output: output.trim() };
  } catch (err) {
    return { ok: false, output: err.stderr || err.message };
  }
}

function fileHash(filePath) {
  try {
    return createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function stopServer() {
  // Find process on port 4111 and kill it
  const result = run('powershell -Command "Get-NetTCPConnection -LocalPort 4111 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"');
  if (result.ok && result.output) {
    const pids = [...new Set(result.output.split('\n').map(p => p.trim()).filter(Boolean))];
    for (const pid of pids) {
      if (pid === '0') continue;
      log(`Stopping process on port 4111 (PID ${pid})`);
      run(`taskkill //F //PID ${pid}`);
    }
    return pids.length > 0;
  }
  return false;
}

async function main() {
  const startAfter = process.argv.includes('--start');

  log('=== Auto-update started ===');

  // Check we're in a git repo with a remote
  const remoteResult = run('git remote -v');
  if (!remoteResult.ok || !remoteResult.output.includes('origin')) {
    log('ERROR: No git remote "origin" found. Aborting.');
    process.exit(1);
  }

  // Fetch latest
  const fetchResult = run('git fetch origin');
  if (!fetchResult.ok) {
    log('ERROR: git fetch failed: ' + fetchResult.output);
    process.exit(1);
  }

  // Check if we're behind
  const statusResult = run('git status -uno');
  if (!statusResult.ok) {
    log('ERROR: git status failed');
    process.exit(1);
  }

  const behind = statusResult.output.includes('behind');
  const upToDate = statusResult.output.includes('up to date');

  if (upToDate) {
    log('Already up to date. No update needed.');
    if (startAfter) startWatchdog();
    return;
  }

  if (!behind) {
    // Could be ahead or diverged — don't auto-pull
    log('Branch is not simply behind origin. Manual intervention needed.');
    log('Status: ' + statusResult.output);
    if (startAfter) startWatchdog();
    return;
  }

  // Snapshot package-lock hash before pull
  const lockHashBefore = fileHash(LOCKFILE);

  // Pull
  log('Updates available — pulling...');
  const pullResult = run('git pull --ff-only origin master');
  if (!pullResult.ok) {
    log('ERROR: git pull failed (non-fast-forward?): ' + pullResult.output);
    log('Manual intervention needed.');
    if (startAfter) startWatchdog();
    return;
  }
  log('Pull successful: ' + pullResult.output);

  // Check if deps changed
  const lockHashAfter = fileHash(LOCKFILE);
  if (lockHashBefore !== lockHashAfter) {
    log('package-lock.json changed — running npm install...');
    const installResult = run('npm install --production', { timeout: 300000 });
    if (!installResult.ok) {
      log('WARNING: npm install had issues: ' + installResult.output);
    } else {
      log('npm install complete');
    }
  } else {
    log('Dependencies unchanged — skipping npm install');
  }

  // Rebuild
  log('Building...');
  const buildResult = run('npm run build');
  if (!buildResult.ok) {
    log('ERROR: Build failed: ' + buildResult.output);
    process.exit(1);
  }
  log('Build successful');

  // Stop running server so watchdog restarts with new code
  const wasStopped = stopServer();
  if (wasStopped) {
    log('Stopped running server — watchdog will restart it');
  }

  log('=== Auto-update complete ===');

  if (startAfter) startWatchdog();
}

function startWatchdog() {
  log('Starting watchdog...');
  const { spawn } = require('child_process');
  const watchdog = spawn('node', [path.join(__dirname, 'watchdog.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    detached: false,
  });
  watchdog.on('exit', (code) => process.exit(code || 0));
}

main().catch(err => {
  log('ERROR: ' + err.message);
  process.exit(1);
});
