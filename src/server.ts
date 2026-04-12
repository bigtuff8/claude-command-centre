import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import * as path from 'path';
import { AppConfig } from './types';
import { initSessionStore } from './state/sessions';
import { initPermissionService } from './services/permission';
import { initNotifications } from './services/notifications';
import { createHooksRouter } from './routes/hooks';
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

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // Serve dashboard static files
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Hook endpoints
  const hooksRouter = createHooksRouter(broadcast);
  app.use('/hooks', hooksRouter);

  // Health check
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // API: get current state (for page refresh / reconnection)
  app.get('/api/sessions', (_req, res) => {
    const { getAllSessions, sessionToDTO, getFeedEvents } = require('./state/sessions');
    res.json({
      sessions: getAllSessions().map(sessionToDTO),
      feedEvents: getFeedEvents(),
    });
  });

  // Socket.io handler
  initSocketHandler(io);

  return { app, httpServer, io };
}
