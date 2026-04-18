import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import * as path from 'path';
import { AppConfig } from './types';
import { initSessionStore, getSession, registerTerminal } from './state/sessions';
import { initPermissionService } from './services/permission';
import { initNotifications } from './services/notifications';
import { initSdkSessionService } from './services/sdk-session';
import { readTranscript, readUsageFromTranscript } from './services/transcript';
import { focusTerminalWindow, resolveTerminalWindowPid } from './services/focus';
import { createHooksRouter } from './routes/hooks';
import { createPortfolioRouter } from './routes/portfolio';
import { initSocketHandler } from './socket/handler';

export function createApp(config: AppConfig) {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
  });

  // Broadcast helper — sends to all connected dashboard clients
  const broadcast = (event: string, data: any) => {
    io.emit(event, data);
  };

  // Initialise subsystems
  initSessionStore(config);
  initPermissionService(config, broadcast);
  initNotifications(config);
  initSdkSessionService(broadcast);

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // Serve dashboard static files
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Hook endpoints
  const hooksRouter = createHooksRouter(broadcast, config);
  app.use('/hooks', hooksRouter);

  // Portfolio API routes
  const portfolioRouter = createPortfolioRouter();
  app.use('/api/portfolio', portfolioRouter);

  // Health check
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // API: register a terminal window PID for a project path (called by the launcher)
  app.post('/api/register-terminal', async (req, res) => {
    const { projectPath, launcherPid } = req.body;
    if (!projectPath || !launcherPid) {
      res.status(400).json({ error: 'projectPath and launcherPid required' });
      return;
    }

    console.log(`[Register] Terminal registration: ${projectPath} (launcher PID ${launcherPid})`);
    const windowPid = await resolveTerminalWindowPid(launcherPid);
    if (windowPid) {
      registerTerminal(projectPath, windowPid);
      console.log(`[Register] Mapped ${projectPath} → window PID ${windowPid}`);
      res.json({ ok: true, windowPid });
    } else {
      console.log(`[Register] Could not find window for launcher PID ${launcherPid}`);
      res.json({ ok: false, reason: 'window_not_found' });
    }
  });

  // API: get current state (for page refresh / reconnection)
  app.get('/api/sessions', (_req, res) => {
    const { getAllSessions, sessionToDTO, getFeedEvents } = require('./state/sessions');
    res.json({
      sessions: getAllSessions().map(sessionToDTO),
      feedEvents: getFeedEvents(),
    });
  });

  // API: cleanup test sessions (used by Playwright teardown)
  app.delete('/api/sessions/test-cleanup', (_req, res) => {
    const { getAllSessions, removeSession } = require('./state/sessions');
    const testSessions = getAllSessions().filter((s: any) => s.id.startsWith('test-'));
    for (const s of testSessions) {
      removeSession(s.id);
      broadcast('session-removed', { sessionId: s.id });
    }
    res.json({ removed: testSessions.length });
  });

  // API: get transcript for a session
  app.get('/api/sessions/:id/transcript', (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!session.transcriptPath) {
      res.json({ messages: [], status: 'no_transcript_path' });
      return;
    }
    const messages = readTranscript(session.transcriptPath);
    res.json({ messages, transcriptPath: session.transcriptPath });
  });

  // B010: API: get token usage for a session (prefer live data for SDK sessions)
  app.get('/api/sessions/:id/usage', (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // SDK sessions with result event data: use accurate CLI-reported usage
    if (session.usage.lastUpdated) {
      res.json({
        inputTokens: session.usage.inputTokens,
        outputTokens: session.usage.outputTokens,
        cacheReadTokens: session.usage.cacheReadTokens,
        cacheCreationTokens: session.usage.cacheCreationTokens,
        totalTokens: session.usage.inputTokens + session.usage.outputTokens,
        estimatedCostUSD: session.usage.totalCostUSD,
        source: 'live',
      });
      return;
    }
    // Hook-monitored sessions: fall back to deduplicated transcript parsing
    if (session.transcriptPath) {
      const usage = readUsageFromTranscript(session.transcriptPath);
      res.json({ ...usage, source: 'transcript' });
      return;
    }
    res.json({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, estimatedCostUSD: 0, source: 'none' });
  });

  // B010: API: get aggregate usage across all sessions
  app.get('/api/usage', (_req, res) => {
    const { getAllSessions } = require('./state/sessions');
    const allSessions = getAllSessions();
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCost = 0;
    for (const s of allSessions) {
      // Prefer live session usage (SDK sessions with result events)
      if (s.usage.lastUpdated) {
        totalInput += s.usage.inputTokens;
        totalOutput += s.usage.outputTokens;
        totalCacheRead += s.usage.cacheReadTokens;
        totalCost += s.usage.totalCostUSD;
      } else if (s.transcriptPath) {
        const u = readUsageFromTranscript(s.transcriptPath);
        totalInput += u.inputTokens;
        totalOutput += u.outputTokens;
        totalCacheRead += u.cacheReadTokens;
        totalCost += u.estimatedCostUSD;
      }
    }
    const totalTokens = totalInput + totalOutput;
    res.json({ totalTokens, totalInput, totalOutput, totalCacheRead, estimatedCostUSD: totalCost });
  });

  // API: focus terminal window for a session
  app.post('/api/sessions/:id/focus', (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    focusTerminalWindow(session.terminalPid, session.name, session.project);
    res.json({ ok: true });
  });

  // Socket.io handler
  initSocketHandler(io);

  return { app, httpServer, io };
}
