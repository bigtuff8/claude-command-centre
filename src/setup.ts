#!/usr/bin/env node

/**
 * Setup script: injects Command Centre HTTP hook configuration
 * into the user's Claude Code settings file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';

const config = loadConfig();
const PORT = config.port;

const HOOK_CONFIG = {
  PreToolUse: [
    {
      hooks: [
        {
          type: 'http',
          url: `http://localhost:${PORT}/hooks/pre-tool-use`,
          timeout: config.permissionTimeoutSeconds,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      hooks: [
        {
          type: 'http',
          url: `http://localhost:${PORT}/hooks/post-tool-use`,
        },
      ],
    },
  ],
  SessionStart: [
    {
      hooks: [
        {
          type: 'http',
          url: `http://localhost:${PORT}/hooks/session-start`,
        },
      ],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        {
          type: 'http',
          url: `http://localhost:${PORT}/hooks/session-end`,
        },
      ],
    },
  ],
};

function getClaudeSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.claude', 'settings.json');
}

function run(): void {
  const settingsPath = getClaudeSettingsPath();
  console.log(`\nCommand Centre Setup`);
  console.log(`====================\n`);
  console.log(`Claude settings file: ${settingsPath}`);

  let settings: any = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      console.log('Found existing settings — will merge hooks.\n');
    } catch {
      console.error('Error: Could not parse existing settings.json');
      process.exit(1);
    }
  } else {
    console.log('No existing settings found — will create new file.\n');
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Merge hooks
  if (!settings.hooks) settings.hooks = {};

  let addedCount = 0;
  for (const [eventName, hookEntries] of Object.entries(HOOK_CONFIG)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }

    // Check if our hook URL is already configured
    const ourUrl = (hookEntries[0] as any).hooks[0].url;
    const alreadyExists = settings.hooks[eventName].some((entry: any) =>
      entry.hooks?.some((h: any) => h.url === ourUrl)
    );

    if (!alreadyExists) {
      settings.hooks[eventName].push(...hookEntries);
      addedCount++;
      console.log(`  + Added ${eventName} hook → ${ourUrl}`);
    } else {
      console.log(`  = ${eventName} hook already configured`);
    }
  }

  if (addedCount > 0) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`\nDone. ${addedCount} hook(s) added to ${settingsPath}`);
  } else {
    console.log('\nAll hooks already configured. No changes needed.');
  }

  console.log(`\nNext: run 'command-centre' (or 'npm start') to start the dashboard.`);
  console.log(`Then start Claude Code sessions — they will appear automatically.\n`);
}

run();
