import { Server as SocketServer, Socket } from 'socket.io';
import * as fs from 'fs';
import { getSession, getAllSessions, sessionToDTO, getFeedEvents, removeSession, renameSession } from '../state/sessions';
import { resolvePermission } from '../services/permission';
import { spawnSession } from '../services/spawner';
import { launchSdkSession, sendMessage, isProcessing, killSession } from '../services/sdk-session';
import { startPolling, stopPolling } from '../services/transcript';
import { focusTerminalWindow } from '../services/focus';
import { getHooksConfig, setAutoApproveAll } from '../routes/hooks';
import { getConfigPath } from '../config';

export function initSocketHandler(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Dashboard] Client connected (${socket.id})`);

    // Send current state to newly connected client
    const sessions = getAllSessions().map(sessionToDTO);
    const currentConfig = getHooksConfig();
    socket.emit('init', {
      sessions,
      feedEvents: getFeedEvents(),
      autoApproveAll: currentConfig.autoApproveAll,
    });

    // Handle permission approval/denial from dashboard
    socket.on('permission-response', (data: { sessionId: string; decision: 'allow' | 'deny'; reason?: string }) => {
      const session = getSession(data.sessionId);
      if (!session) {
        socket.emit('error', { message: `Session ${data.sessionId} not found` });
        return;
      }

      const resolved = resolvePermission(session, data.decision, data.reason);
      if (resolved) {
        console.log(`[Permission] ${session.name}: ${data.decision} via dashboard`);
        io.emit('permission-resolved', {
          sessionId: session.id,
          decision: data.decision,
        });
        io.emit('session-updated', sessionToDTO(session));
      } else {
        socket.emit('error', { message: `No pending permission for session ${session.name}` });
      }
    });

    // Handle dismissing a session from dashboard
    socket.on('dismiss-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (!session) return;

      // Only allow dismissing completed, errored, or stopped sessions
      if (session.status !== 'completed' && session.status !== 'errored' && session.status !== 'stopped') {
        socket.emit('error', { message: `Cannot dismiss active session: ${session.name}` });
        return;
      }

      console.log(`[Dismiss] Removed session: ${session.name}`);
      removeSession(data.sessionId);
      io.emit('session-removed', { sessionId: data.sessionId });
    });

    // Handle new session launch from dashboard (B002: supports viaLauncher mode)
    socket.on('launch-session', (data: { projectDir?: string; name?: string; prompt?: string; viaLauncher?: boolean }) => {
      if (data.viaLauncher) {
        console.log('[Launch] Opening launcher in new terminal');
        try {
          spawnSession('', undefined, undefined, true);
          socket.emit('launch-ack', { success: true, name: 'Launcher' });
        } catch (err: any) {
          socket.emit('launch-ack', { success: false, error: err.message });
        }
        return;
      }
      console.log(`[Launch] Spawning session: ${data.name || data.projectDir}`);
      try {
        spawnSession(data.projectDir || '', data.name, data.prompt);
        socket.emit('launch-ack', { success: true, name: data.name || data.projectDir });
      } catch (err: any) {
        socket.emit('launch-ack', { success: false, error: err.message });
      }
    });

    // B005: Handle kill session from dashboard
    socket.on('kill-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      if (session.sessionType === 'sdk-managed') {
        // Dashboard-managed: kill the child process
        killSession(data.sessionId);
        session.status = 'stopped';
        console.log(`[Kill] Stopped SDK session: ${session.name}`);
      } else if (session.terminalPid) {
        // Terminal session with known PID: attempt to kill
        try {
          process.kill(session.terminalPid, 'SIGTERM');
          session.status = 'stopped';
          console.log(`[Kill] Sent SIGTERM to PID ${session.terminalPid}: ${session.name}`);
        } catch (err: any) {
          console.log(`[Kill] Failed to kill PID ${session.terminalPid}: ${err.message}`);
          socket.emit('error', { message: 'Could not stop terminal session — switch to terminal to stop it manually.' });
          return;
        }
      } else {
        // Terminal session without PID: can't kill
        socket.emit('error', { message: 'This session is running in a terminal. Switch to the terminal to stop it.' });
        return;
      }

      io.emit('session-updated', sessionToDTO(session));
    });

    // Handle launching a dashboard-managed (SDK) session
    socket.on('launch-sdk-session', (data: { projectDir: string; name?: string; prompt: string; permissionMode?: string }) => {
      if (!data.prompt?.trim()) {
        socket.emit('launch-ack', { success: false, error: 'Prompt is required for dashboard sessions' });
        return;
      }
      console.log(`[Launch-SDK] Starting dashboard session: ${data.name || data.projectDir}`);
      try {
        const sessionId = launchSdkSession(
          data.projectDir,
          data.name,
          data.prompt.trim(),
          data.permissionMode || 'default',
        );
        socket.emit('launch-ack', { success: true, sessionId, name: data.name || data.projectDir });
      } catch (err: any) {
        socket.emit('launch-ack', { success: false, error: err.message });
      }
    });

    // Handle sending a message to an SDK-managed session
    socket.on('send-message', (data: { sessionId: string; text: string }) => {
      if (!data.text?.trim()) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }
      if (isProcessing(data.sessionId)) {
        socket.emit('error', { message: 'Session is still processing — wait for Claude to finish' });
        return;
      }
      const sent = sendMessage(data.sessionId, data.text.trim());
      if (!sent) {
        socket.emit('error', { message: 'Cannot send message — session not found or not dashboard-managed' });
      }
    });

    // Handle transcript viewing — start polling when client opens a session
    let watchingSessionId: string | null = null;

    socket.on('watch-transcript', (data: { sessionId: string }) => {
      // Stop any existing polling for this client
      if (watchingSessionId) {
        stopPolling(`${socket.id}-${watchingSessionId}`);
      }

      const session = getSession(data.sessionId);
      if (!session?.transcriptPath) {
        socket.emit('transcript-error', { message: 'No transcript path for this session' });
        return;
      }

      watchingSessionId = data.sessionId;
      startPolling(
        `${socket.id}-${data.sessionId}`,
        session.transcriptPath,
        (newMessages) => {
          socket.emit('transcript-update', {
            sessionId: data.sessionId,
            messages: newMessages,
          });
        }
      );
      console.log(`[Transcript] Client ${socket.id} watching session ${session.name}`);
    });

    socket.on('unwatch-transcript', () => {
      if (watchingSessionId) {
        stopPolling(`${socket.id}-${watchingSessionId}`);
        watchingSessionId = null;
      }
    });

    // Handle renaming a session from dashboard
    socket.on('rename-session', (data: { sessionId: string; name: string }) => {
      const trimmed = (data.name || '').trim();
      if (!trimmed) {
        socket.emit('error', { message: 'Session name cannot be empty' });
        return;
      }
      const session = renameSession(data.sessionId, trimmed);
      if (session) {
        console.log(`[Rename] Session ${data.sessionId} → "${trimmed}"`);
        io.emit('session-updated', sessionToDTO(session));
      } else {
        socket.emit('error', { message: `Session ${data.sessionId} not found` });
      }
    });

    // B006: Hold/resume session from dashboard
    socket.on('hold-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (!session) return;
      if (session.sessionType !== 'sdk-managed') {
        socket.emit('error', { message: 'Only dashboard-managed sessions can be put on hold' });
        return;
      }
      session.status = 'held';
      console.log(`[Hold] Session on hold: ${session.name}`);
      io.emit('session-updated', sessionToDTO(session));
    });

    socket.on('resume-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (!session || session.status !== 'held') return;
      session.status = 'active';
      console.log(`[Resume] Session resumed: ${session.name}`);
      io.emit('session-updated', sessionToDTO(session));
    });

    // Handle focus terminal request via Socket.io
    socket.on('focus-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (session) {
        focusTerminalWindow(session.terminalPid, session.name, session.project);
      }
    });

    // Handle ending an SDK session from dashboard
    socket.on('end-sdk-session', (data: { sessionId: string }) => {
      const session = getSession(data.sessionId);
      if (!session || session.sessionType !== 'sdk-managed') return;
      killSession(data.sessionId);
      session.status = 'completed';
      io.emit('session-updated', sessionToDTO(session));
      console.log(`[SDK-Session] ${session.name} ended by user`);
    });

    // B017: Global auto-approve toggle (no restart needed)
    socket.on('set-global-auto-approve', (data: { enabled: boolean }) => {
      setAutoApproveAll(data.enabled);
      console.log(`[AutoApprove] Global auto-approve: ${data.enabled ? 'ON' : 'OFF'}`);

      // Persist to config.json
      try {
        const configPath = getConfigPath();
        const raw = fs.readFileSync(configPath, 'utf-8');
        const configObj = JSON.parse(raw);
        configObj.autoApproveAll = data.enabled;
        fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf-8');
      } catch (err: any) {
        console.warn(`[AutoApprove] Failed to persist config: ${err.message}`);
      }

      io.emit('global-auto-approve-changed', { enabled: data.enabled });
    });

    // B017: Per-session auto-approve toggle
    socket.on('set-session-auto-approve', (data: { sessionId: string; enabled: boolean | null }) => {
      const session = getSession(data.sessionId);
      if (!session) return;
      session.autoApprove = data.enabled;
      console.log(`[AutoApprove] Session ${session.name}: ${data.enabled === null ? 'inherit global' : data.enabled ? 'ON' : 'OFF'}`);
      io.emit('session-updated', sessionToDTO(session));
    });

    // B017: Get current global auto-approve state
    socket.on('get-auto-approve-state', () => {
      const config = getHooksConfig();
      socket.emit('auto-approve-state', { enabled: config.autoApproveAll });
    });

    socket.on('disconnect', () => {
      // Clean up any transcript polling for this client
      if (watchingSessionId) {
        stopPolling(`${socket.id}-${watchingSessionId}`);
      }
      console.log(`[Dashboard] Client disconnected (${socket.id})`);
    });
  });
}
