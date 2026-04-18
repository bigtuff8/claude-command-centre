import { Router, Request, Response } from 'express';
import { HookPayload, FeedEventDTO, AppConfig } from '../types';
import { getOrCreateSession, addEvent, addFeedEvent, sessionToDTO } from '../state/sessions';
import { createPermissionRequest, isAutoPassTool } from '../services/permission';
import { notifyPermissionRequest, notifySessionComplete } from '../services/notifications';
// Terminal PID is now resolved via the registry (populated by the launcher's
// POST to /api/register-terminal). The getOrCreateSession() call auto-applies
// the registry lookup, so no additional discovery logic is needed here.

let broadcastFn: (event: string, data: any) => void;
let appConfig: AppConfig;

export function getHooksConfig(): AppConfig {
  return appConfig;
}

export function setAutoApproveAll(value: boolean): void {
  appConfig.autoApproveAll = value;
}

export function createHooksRouter(broadcast: (event: string, data: any) => void, config: AppConfig): Router {
  broadcastFn = broadcast;
  appConfig = config;
  const router = Router();

  router.post('/session-start', handleSessionStart);
  router.post('/session-end', handleSessionEnd);
  router.post('/pre-tool-use', handlePreToolUse);
  router.post('/post-tool-use', handlePostToolUse);

  return router;
}

function handleSessionStart(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  console.log('[SessionStart] Payload keys:', Object.keys(payload).join(', '));
  const session = getOrCreateSession(payload.session_id, payload.cwd, payload.permission_mode);

  // Capture transcript path — from payload or derive from session_id
  if (payload.transcript_path) {
    session.transcriptPath = payload.transcript_path;
  } else if (payload.session_id && payload.cwd) {
    session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
  }

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

  if (session.terminalPid) {
    console.log(`[SessionStart] ${session.name} (${session.id.substring(0, 8)}) → terminal PID ${session.terminalPid}`);
  } else {
    console.log(`[SessionStart] ${session.name} (${session.id.substring(0, 8)}) — no terminal PID yet`);
  }
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

  // Capture transcript path — from payload or derive
  if (!session.transcriptPath) {
    if (payload.transcript_path) {
      session.transcriptPath = payload.transcript_path;
    } else if (payload.session_id && payload.cwd) {
      session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
    }
  }

  // Auto-pass tools that don't need permission prompting
  if (isAutoPassTool(toolName, session.permissionMode)) {
    broadcastFn('session-updated', sessionToDTO(session));
    res.json({});
    return;
  }

  // B012/B017: Auto-approve permissions (session-level overrides global)
  const sessionAutoApprove = session.autoApprove;
  const shouldAutoApprove = sessionAutoApprove === true || (sessionAutoApprove === null && (appConfig.autoApproveAll || appConfig.autoApproveTools.includes(toolName)));
  if (shouldAutoApprove) {
    const detail = getToolDetail(toolName, toolInput);
    const humanDetail = getHumanReadableApproval(toolName, toolInput);
    console.log(`[Permission] Auto-approved: ${session.name} → ${toolName}(${detail})`);
    broadcastFn('session-updated', sessionToDTO(session));
    const feedEvt: FeedEventDTO = {
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      sessionName: session.name,
      eventName: 'PermissionAutoApproved',
      toolName,
      detail: humanDetail,
    };
    addFeedEvent(feedEvt);
    broadcastFn('feed-event', feedEvt);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved via Command Centre',
      },
    });
    return;
  }

  // B006: Auto-decline permissions when session is on hold
  if (session.status === 'held') {
    console.log(`[Permission] Auto-declined (session on hold): ${session.name} → ${toolName}`);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Session paused via Command Centre dashboard',
      },
    });
    return;
  }

  // Hold the request and wait for dashboard response
  console.log(`[Permission] ${session.name} requesting: ${toolName}(${getToolDetail(toolName, toolInput)})`);

  notifyPermissionRequest(session.name, toolName, toolInput);

  // IMPORTANT: createPermissionRequest must be called BEFORE broadcasting session-updated,
  // because it sets session.pendingPermission and session.status = 'waiting'.
  // If we broadcast session-updated first, the DTO has pendingPermission: null,
  // which clobbers the client-side state set by the permission-requested event.
  const permissionPromise = createPermissionRequest(session, toolName, toolInput, toolUseId);

  // Now session.pendingPermission is set — safe to broadcast
  broadcastFn('permission-requested', {
    sessionId: session.id,
    sessionName: session.name,
    toolName,
    toolInput,
    toolUseId,
  });
  broadcastFn('session-updated', sessionToDTO(session));

  const response = await permissionPromise;
  broadcastFn('session-updated', sessionToDTO(session));
  res.json(response);
}

function handlePostToolUse(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd);
  const toolName = payload.tool_name || 'Unknown';
  const toolInput = payload.tool_input || {};

  if (!session.transcriptPath) {
    if (payload.transcript_path) {
      session.transcriptPath = payload.transcript_path;
    } else if (payload.session_id && payload.cwd) {
      session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
    }
  }

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

function deriveTranscriptPath(sessionId: string, cwd: string): string | null {
  const fs = require('fs');
  const path = require('path');
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // Claude Code stores transcripts at: ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl
  // The encoded cwd replaces path separators and colons with dashes
  const encoded = cwd.replace(/[:\\\/]/g, '-').replace(/^-+/, '');
  const transcriptPath = path.join(home, '.claude', 'projects', encoded, sessionId + '.jsonl');

  if (fs.existsSync(transcriptPath)) {
    return transcriptPath;
  }

  // Try finding the file by scanning project directories
  const projectsDir = path.join(home, '.claude', 'projects');
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
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

function getHumanReadableApproval(toolName: string, toolInput: Record<string, any>): string {
  const fileName = toolInput.file_path ? String(toolInput.file_path).split(/[/\\]/).pop() : null;
  switch (toolName) {
    case 'Bash': {
      const cmd = String(toolInput.command || '').substring(0, 80);
      return `Approved running command: ${cmd}`;
    }
    case 'Edit':
      return `Approved editing ${fileName || 'a file'}`;
    case 'Write':
      return `Approved writing to ${fileName || 'a file'}`;
    case 'Read':
      return `Approved reading ${fileName || 'a file'}`;
    case 'Glob':
      return `Approved file search: ${toolInput.pattern || ''}`;
    case 'Grep':
      return `Approved content search: "${String(toolInput.pattern || '').substring(0, 60)}"`;
    case 'Agent':
      return `Approved launching a sub-agent`;
    case 'WebSearch':
      return `Approved web search`;
    case 'WebFetch':
      return `Approved fetching a web page`;
    case 'Skill':
      return `Approved running skill: ${toolInput.skill || 'unknown'}`;
    default:
      return `Approved ${toolName}: ${getToolDetail(toolName, toolInput)}`;
  }
}
