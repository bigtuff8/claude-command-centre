import { Router, Request, Response } from 'express';
import { HookPayload, FeedEventDTO } from '../types';
import { getOrCreateSession, addEvent, addFeedEvent, sessionToDTO } from '../state/sessions';
import { createPermissionRequest, isAutoPassTool } from '../services/permission';
import { notifyPermissionRequest, notifySessionComplete } from '../services/notifications';

let broadcastFn: (event: string, data: any) => void;

export function createHooksRouter(broadcast: (event: string, data: any) => void): Router {
  broadcastFn = broadcast;
  const router = Router();

  router.post('/session-start', handleSessionStart);
  router.post('/session-end', handleSessionEnd);
  router.post('/pre-tool-use', handlePreToolUse);
  router.post('/post-tool-use', handlePostToolUse);

  return router;
}

function handleSessionStart(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd, payload.permission_mode);

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'SessionStart',
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'SessionStart',
    detail: 'Session started',
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-added', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);

  console.log(`[SessionStart] ${session.name} (${session.id.substring(0, 8)})`);
  res.json({});
}

function handleSessionEnd(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd);

  session.status = 'completed';
  if (session.pendingPermission) {
    clearTimeout(session.pendingPermission.timeout);
    session.pendingPermission.resolve({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    });
    session.pendingPermission = null;
  }

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'SessionEnd',
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'SessionEnd',
    detail: 'Session completed',
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-updated', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);
  notifySessionComplete(session.name);

  console.log(`[SessionEnd] ${session.name}`);
  res.json({});
}

async function handlePreToolUse(req: Request, res: Response): Promise<void> {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd, payload.permission_mode);
  const toolName = payload.tool_name || 'Unknown';
  const toolInput = payload.tool_input || {};
  const toolUseId = payload.tool_use_id || '';

  // Record the event regardless
  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'PreToolUse',
    toolName,
    toolInput,
    toolUseId,
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'PreToolUse',
    toolName,
    detail: getToolDetail(toolName, toolInput),
  };
  addFeedEvent(feedEvent);
  broadcastFn('feed-event', feedEvent);

  // Auto-pass tools that don't need permission prompting
  if (isAutoPassTool(toolName, session.permissionMode)) {
    broadcastFn('session-updated', sessionToDTO(session));
    res.json({});
    return;
  }

  // Hold the request and wait for dashboard response
  console.log(`[Permission] ${session.name} requesting: ${toolName}(${getToolDetail(toolName, toolInput)})`);

  notifyPermissionRequest(session.name, toolName, toolInput);
  broadcastFn('permission-requested', {
    sessionId: session.id,
    sessionName: session.name,
    toolName,
    toolInput,
    toolUseId,
  });
  broadcastFn('session-updated', sessionToDTO(session));

  const response = await createPermissionRequest(session, toolName, toolInput, toolUseId);
  broadcastFn('session-updated', sessionToDTO(session));
  res.json(response);
}

function handlePostToolUse(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd);
  const toolName = payload.tool_name || 'Unknown';
  const toolInput = payload.tool_input || {};

  session.toolCount++;
  session.lastActivity = new Date();

  // Track modified files
  if (['Edit', 'Write'].includes(toolName) && toolInput.file_path) {
    session.filesModified.add(String(toolInput.file_path));
  }

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'PostToolUse',
    toolName,
    toolInput,
    toolUseId: payload.tool_use_id,
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'PostToolUse',
    toolName,
    detail: getToolDetail(toolName, toolInput),
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-updated', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);

  res.json({});
}

function getToolDetail(toolName: string, toolInput: Record<string, any>): string {
  if (toolName === 'Bash' && toolInput.command) {
    return String(toolInput.command).substring(0, 120);
  }
  if (toolName === 'Edit' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Write' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Read' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Glob' && toolInput.pattern) {
    return String(toolInput.pattern);
  }
  if (toolName === 'Grep' && toolInput.pattern) {
    return `"${String(toolInput.pattern).substring(0, 60)}"`;
  }
  return JSON.stringify(toolInput).substring(0, 80);
}
