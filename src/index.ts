#!/usr/bin/env node

import { loadConfig } from './config';
import { createApp } from './server';
import { killAllSessions } from './services/sdk-session';

const config = loadConfig();
const { httpServer } = createApp(config);

const bindHost = config.host === 'localhost' ? '127.0.0.1' : config.host;
const displayHost = config.host === '0.0.0.0' ? 'all interfaces' : config.host;

httpServer.listen(config.port, bindHost, () => {
  console.log('');
  console.log('  Command Centre');
  console.log(`  Dashboard:  http://${config.host}:${config.port}`);
  console.log(`  Hooks:      http://localhost:${config.port}/hooks/*`);
  console.log(`  Health:     http://localhost:${config.port}/healthz`);
  if (config.host !== 'localhost') {
    console.log(`  Binding:    ${displayHost} (accessible on network)`);
  }
  console.log('');
  console.log('  Waiting for Claude Code sessions...');
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
  killAllSessions();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killAllSessions();
  httpServer.close();
  process.exit(0);
});
