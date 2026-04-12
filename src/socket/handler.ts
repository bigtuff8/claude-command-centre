import { Server as SocketServer, Socket } from 'socket.io';
import { getSession, getAllSessions, sessionToDTO, getFeedEvents } from '../state/sessions';
import { resolvePermission } from '../services/permission';
import { spawnSession } from '../services/spawner';

export function initSocketHandler(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Dashboard] Client connected (${socket.id})`);

    // Send current state to newly connected client
    const sessions = getAllSessions().map(sessionToDTO);
    socket.emit('init', {
      sessions,
      feedEvents: getFeedEvents(),
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

    // Handle new session launch from dashboard
    socket.on('launch-session', (data: { projectDir: string; name?: string; prompt?: string }) => {
      console.log(`[Launch] Spawning session: ${data.name || data.projectDir}`);
      try {
        spawnSession(data.projectDir, data.name, data.prompt);
        socket.emit('launch-ack', { success: true, name: data.name || data.projectDir });
      } catch (err: any) {
        socket.emit('launch-ack', { success: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Dashboard] Client disconnected (${socket.id})`);
    });
  });
}
