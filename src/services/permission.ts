import { Session, HookResponse, AppConfig } from '../types';

let config: AppConfig;
let broadcastFn: (event: string, data: any) => void;

export function initPermissionService(appConfig: AppConfig, broadcast: (event: string, data: any) => void): void {
  config = appConfig;
  broadcastFn = broadcast;
}

export function createPermissionRequest(
  session: Session,
  toolName: string,
  toolInput: Record<string, any>,
  toolUseId: string
): Promise<HookResponse> {
  return new Promise<HookResponse>((resolve) => {
    const timeout = setTimeout(() => {
      // Timeout: fall through to terminal prompt
      resolve({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
        },
      });
      session.pendingPermission = null;
      session.status = 'active';
      broadcastFn('permission-timeout', { sessionId: session.id });
    }, config.permissionTimeoutSeconds * 1000);

    session.pendingPermission = {
      toolName,
      toolInput,
      toolUseId,
      receivedAt: new Date(),
      resolve,
      timeout,
    };

    session.status = 'waiting';
  });
}

export function resolvePermission(session: Session, decision: 'allow' | 'deny', reason?: string): boolean {
  if (!session.pendingPermission) return false;

  clearTimeout(session.pendingPermission.timeout);
  session.pendingPermission.resolve({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason || `${decision === 'allow' ? 'Approved' : 'Denied'} via Command Centre`,
    },
  });

  session.pendingPermission = null;
  session.status = 'active';
  return true;
}

export function isAutoPassTool(toolName: string, permissionMode: string): boolean {
  if (permissionMode === 'bypassPermissions') return true;
  return config.autoPassTools.includes(toolName);
}
