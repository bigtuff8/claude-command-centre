#!/usr/bin/env node

/**
 * Installs the Command Centre watchdog to run on Windows login.
 * Uses the user's Startup folder (no admin required).
 */

const fs = require('fs');
const path = require('path');

const WATCHDOG_PATH = path.join(__dirname, 'watchdog.js');
const NODE_PATH = process.execPath;
const BAT_PATH = path.join(__dirname, 'start-watchdog.bat');

// Create the .bat launcher
const batContent = [
  '@echo off',
  `cd /d "${path.join(__dirname, '..')}"`,
  `"${NODE_PATH}" "${WATCHDOG_PATH}"`,
].join('\r\n');

fs.writeFileSync(BAT_PATH, batContent, 'utf-8');

// Create a shortcut in the Startup folder
const startupFolder = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutBat = path.join(startupFolder, 'CommandCentre.bat');

// The startup .bat runs the watchdog minimised via start /min
const startupContent = [
  '@echo off',
  `start /min "" "${BAT_PATH}"`,
].join('\r\n');

fs.writeFileSync(shortcutBat, startupContent, 'utf-8');

console.log('Installed Command Centre to start on login.');
console.log('');
console.log(`  Startup script: ${shortcutBat}`);
console.log(`  Watchdog bat:   ${BAT_PATH}`);
console.log(`  Node:           ${NODE_PATH}`);
console.log('');
console.log('The server will start minimised on your next login.');
console.log('');
console.log('To remove: npm run svc:uninstall');
