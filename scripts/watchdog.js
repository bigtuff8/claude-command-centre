#!/usr/bin/env node

/**
 * Command Centre Watchdog
 * Spawns the server and restarts it on crash. Clean exit (code 0) stops the watchdog.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_ENTRY = path.join(__dirname, '..', 'dist', 'index.js');
const DATA_DIR = path.join(__dirname, '..', 'data');
const PID_FILE = path.join(DATA_DIR, 'watchdog.pid');
const RESTART_DELAY_MS = 2000;
const MAX_RAPID_RESTARTS = 5;
const RAPID_RESTART_WINDOW_MS = 30000;

let child = null;
let restartTimes = [];

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Write PID file
fs.writeFileSync(PID_FILE, String(process.pid));

function startServer() {
  // Check for rapid restart loop
  const now = Date.now();
  restartTimes = restartTimes.filter(t => now - t < RAPID_RESTART_WINDOW_MS);
  if (restartTimes.length >= MAX_RAPID_RESTARTS) {
    console.error(`[Watchdog] ${MAX_RAPID_RESTARTS} crashes in ${RAPID_RESTART_WINDOW_MS / 1000}s — giving up. Check server logs.`);
    cleanup();
    process.exit(1);
  }
  restartTimes.push(now);

  console.log(`[Watchdog] Starting server: ${SERVER_ENTRY}`);
  child = spawn('node', [SERVER_ENTRY], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (code === 0) {
      console.log('[Watchdog] Server exited cleanly — stopping watchdog');
      cleanup();
      process.exit(0);
    }
    console.log(`[Watchdog] Server exited (code=${code}, signal=${signal}) — restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(startServer, RESTART_DELAY_MS);
  });

  child.on('error', (err) => {
    console.error(`[Watchdog] Failed to start server: ${err.message}`);
    child = null;
    setTimeout(startServer, RESTART_DELAY_MS);
  });
}

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

// Forward signals to child
process.on('SIGINT', () => {
  if (child) child.kill('SIGINT');
  else { cleanup(); process.exit(0); }
});

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM');
  else { cleanup(); process.exit(0); }
});

process.on('exit', cleanup);

// Start
startServer();
