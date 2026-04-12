import { Session, SessionDTO, HookEvent, FeedEventDTO, AppConfig } from '../types';

const sessions = new Map<string, Session>();
const feedEvents: FeedEventDTO[] = [];
let config: AppConfig;

export function initSessionStore(appConfig: AppConfig): void {
  config = appConfig;
}

export function getOrCreateSession(sessionId: string, cwd?: string, permissionMode?: string): Session {
  let session = sessions.get(sessionId);
  if (!session) {
    const name = cwd ? deriveNameFromPath(cwd) : sessionId.substring(0, 8);
    session = {
      id: sessionId,
      name,
      project: cwd || '',
      status: 'active',
      permissionMode: permissionMode || 'default',
      startedAt: new Date(),
      lastActivity: new Date(),
      toolCount: 0,
      filesModified: new Set(),
      events: [],
      pendingPermission: null,
    };
    sessions.set(sessionId, session);
  }
  if (cwd && !session.project) session.project = cwd;
  if (permissionMode) session.permissionMode = permissionMode;
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

export function addEvent(session: Session, event: HookEvent): void {
  session.events.push(event);
  if (session.events.length > config.maxEventsPerSession) {
    session.events.shift();
  }
  session.lastActivity = new Date();
}

export function addFeedEvent(event: FeedEventDTO): void {
  feedEvents.unshift(event);
  if (feedEvents.length > config.maxTotalFeedEvents) {
    feedEvents.pop();
  }
}

export function getFeedEvents(): FeedEventDTO[] {
  return feedEvents;
}

export function sessionToDTO(session: Session): SessionDTO {
  return {
    id: session.id,
    name: session.name,
    project: session.project,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    lastActivity: session.lastActivity.toISOString(),
    toolCount: session.toolCount,
    filesModified: Array.from(session.filesModified),
    pendingPermission: session.pendingPermission ? {
      toolName: session.pendingPermission.toolName,
      toolInput: session.pendingPermission.toolInput,
      toolUseId: session.pendingPermission.toolUseId,
      receivedAt: session.pendingPermission.receivedAt.toISOString(),
    } : null,
  };
}

function deriveNameFromPath(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  // Return last meaningful folder name
  return parts[parts.length - 1] || 'Unknown';
}
