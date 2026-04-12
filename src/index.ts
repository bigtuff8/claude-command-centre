#!/usr/bin/env node

import { loadConfig } from './config';
import { createApp } from './server';

const config = loadConfig();
const { httpServer } = createApp(config);

httpServer.listen(config.port, '127.0.0.1', () => {
  console.log('');
  console.log('  Command Centre');
  console.log(`  Dashboard:  http://localhost:${config.port}`);
  console.log(`  Hooks:      http://localhost:${config.port}/hooks/*`);
  console.log(`  Health:     http://localhost:${config.port}/healthz`);
  console.log('');
  console.log('  Waiting for Claude Code sessions...');
  console.log('  (Configure hooks in ~/.claude/settings.json or run: command-centre setup)');
  console.log('');

  if (config.openBrowser) {
    import('open').then(({ default: open }) => {
      open(`http://localhost:${config.port}`);
    }).catch(() => {
      // open module not available — user can navigate manually
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Command Centre...');
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  httpServer.close();
  process.exit(0);
});
